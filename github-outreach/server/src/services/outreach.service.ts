import type { OutreachStatus } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { createGmailDraft, sendGmailDraft, sendPlainEmail } from './gmail.service';
import { AppError } from '../utils/errors';
import { maskEmail, normalizeEmail, validateEmail } from '../utils/email';
import { logger } from '../utils/logger';
import { deliveredAttempts, evaluateDraft, evaluateSend, isDeliveredGmailId, startOfLocalDay } from '../utils/send-policy';
import { transitionError } from '../utils/status';
import { contextFromContact, hasUnresolved, interpolate } from '../utils/template';
import { getTemplate } from './template.service';
import { getSendSettings } from './settings.service';
import { emailsAlreadyContacted } from './contact.service';

let sendQueue: Promise<unknown> = Promise.resolve();

function withSendLock<T>(task: () => Promise<T>): Promise<T> {
  const run = sendQueue.then(task, task);
  sendQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function requireContact(contactId: string) {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw new AppError(404, 'Contact not found.', 'NOT_FOUND');
  return contact;
}

export async function listOutreach(status?: OutreachStatus) {
  return prisma.outreach.findMany({
    where: status ? { status } : undefined,
    include: {
      contact: true,
      template: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
}

export async function createDraftForContact(
  contactId: string,
  input: { templateId?: string | null; subject: string; body: string },
) {
  const contact = await requireContact(contactId);
  const decision = evaluateDraft({
    status: contact.status,
    email: contact.email,
    contactAttempts: contact.contactAttempts,
    maxContactAttempts: config.maxContactAttempts,
  });
  if (!decision.ok) throw new AppError(400, decision.message, decision.code);

  if (hasUnresolved(input.subject) || hasUnresolved(input.body)) {
    throw new AppError(
      400,
      'Message still contains unresolved template values. Nothing was sent.',
      'UNRESOLVED_TEMPLATE',
    );
  }

  const email = validateEmail(contact.email);
  if (!email.ok) throw new AppError(400, email.reason, 'INVALID_EMAIL');
  const contacted = await emailsAlreadyContacted([email.email]);
  if (contacted.has(email.email)) {
    throw new AppError(400, 'This email address was already contacted. Nothing was sent.', 'ALREADY_CONTACTED');
  }

  const open = await prisma.outreach.findFirst({
    where: { contactId, status: { in: ['DRAFTED', 'APPROVED'] } },
  });
  if (open) {
    throw new AppError(409, 'A draft is already waiting for this contact. Nothing was sent.', 'DRAFT_EXISTS');
  }

  if (input.templateId) {
    const template = await prisma.template.findUnique({ where: { id: input.templateId } });
    if (!template) throw new AppError(404, 'Template not found.', 'NOT_FOUND');
  }

  if (contact.status !== 'DRAFTED') {
    const reason = transitionError(contact.status, 'DRAFTED');
    if (reason) throw new AppError(400, reason, 'STATUS');
  }

  let gmailDraftId: string;
  try {
    gmailDraftId = await createGmailDraft({
      to: email.email,
      subject: input.subject,
      body: input.body,
    });
  } catch (error) {
    logger.error(
      { contactId, message: error instanceof Error ? error.message : 'draft failed' },
      '[Gmail] Draft creation failed',
    );
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'Draft creation failed. Nothing was sent.', 'DRAFT_FAILED');
  }

  const outreach = await prisma.outreach.create({
    data: {
      contactId,
      templateId: input.templateId || null,
      subject: input.subject,
      body: input.body,
      status: 'DRAFTED',
      gmailDraftId,
    },
    include: { contact: true },
  });
  await prisma.contact.update({ where: { id: contactId }, data: { status: 'DRAFTED' } });
  logger.info({ contactId, outreachId: outreach.id }, '[Gmail] Draft created');
  return outreach;
}

export async function approveOutreach(outreachId: string) {
  const outreach = await prisma.outreach.findUnique({
    where: { id: outreachId },
    include: { contact: true },
  });
  if (!outreach) throw new AppError(404, 'Outreach message not found.', 'NOT_FOUND');

  if (outreach.contact.status === 'OPTED_OUT' || outreach.contact.status === 'DO_NOT_CONTACT') {
    throw new AppError(400, 'This person is marked do-not-contact. Approval is disabled.', 'DO_NOT_CONTACT');
  }
  if (outreach.status !== 'DRAFTED' && outreach.status !== 'FAILED') {
    throw new AppError(400, 'Only a drafted message can be approved.', 'STATUS');
  }
  const reason = transitionError(outreach.contact.status, 'APPROVED');
  if (reason) throw new AppError(400, reason, 'STATUS');

  const updated = await prisma.outreach.update({
    where: { id: outreachId },
    data: { status: 'APPROVED', approvedAt: new Date(), failureReason: null },
    include: { contact: true },
  });
  await prisma.contact.update({ where: { id: outreach.contactId }, data: { status: 'APPROVED' } });
  logger.info({ outreachId, contactId: outreach.contactId }, '[Gmail] Draft approved');
  return updated;
}

export async function sendOutreach(outreachId: string) {
  return withSendLock(async () => {
    const outreach = await prisma.outreach.findUnique({
      where: { id: outreachId },
      include: { contact: true },
    });
    if (!outreach) throw new AppError(404, 'Outreach message not found.', 'NOT_FOUND');

    const sendsToday = await prisma.outreach.count({
      where: { status: 'SENT', sentAt: { gte: startOfLocalDay() } },
    });
    const lastSent = await prisma.outreach.findFirst({
      where: { status: 'SENT', sentAt: { not: null } },
      orderBy: { sentAt: 'desc' },
    });

    const priorSends = await prisma.outreach.findMany({
      where: { contactId: outreach.contactId, status: 'SENT' },
      select: { gmailMessageId: true },
    });
    const delivered = deliveredAttempts([
      outreach.gmailMessageId,
      ...priorSends.map((row) => row.gmailMessageId),
    ]);
    const limits = await getSendSettings();
    const decision = evaluateSend({
      outreachStatus: outreach.status,
      contactStatus: outreach.contact.status,
      email: outreach.contact.email,
      alreadySent: isDeliveredGmailId(outreach.gmailMessageId),
      sendsToday,
      maxSendsPerDay: limits.maxSendsPerDay,
      lastSentAt: lastSent?.sentAt ?? null,
      minSecondsBetweenSends: config.outreachTestMode ? 0 : limits.minSecondsBetweenSends,
      contactAttempts: delivered,
      maxContactAttempts: config.maxContactAttempts,
    });
    if (!decision.ok) throw new AppError(400, decision.message, decision.code);
    if (delivered > 0) {
      throw new AppError(400, 'This email address was already contacted. Nothing was sent.', 'ALREADY_CONTACTED');
    }
    if (config.outreachTestMode) {
      throw new AppError(
        400,
        'Test mode is on, so Gmail was not asked to send. The message is still a draft. Set OUTREACH_TEST_MODE=false in server/.env and restart.',
        'TEST_MODE',
      );
    }
    const recipient = validateEmail(outreach.contact.email);
    if (!recipient.ok) throw new AppError(400, recipient.reason, 'INVALID_EMAIL');
    if (!outreach.subject.trim() || !outreach.body.trim()) {
      throw new AppError(400, 'This message has no subject or body to send.', 'TEMPLATE');
    }

    try {
      const gmailMessageId = await deliverOutreach(outreach.gmailDraftId, {
        to: recipient.email,
        subject: outreach.subject,
        body: outreach.body,
      });
      const sentAt = new Date();
      const updated = await prisma.outreach.update({
        where: { id: outreachId },
        data: { status: 'SENT', sentAt, gmailMessageId, failureReason: null },
        include: { contact: true },
      });
      await prisma.contact.update({
        where: { id: outreach.contactId },
        data: {
          status: 'SENT',
          lastContactedAt: sentAt,
          contactAttempts: { increment: 1 },
        },
      });
      logger.info(
        { outreachId, contactId: outreach.contactId, email: maskEmail(outreach.contact.email) },
        '[Gmail] Message sent',
      );
      return updated;
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Send failed. The message was not confirmed as sent.';
      await prisma.outreach.update({
        where: { id: outreachId },
        data: { status: 'FAILED', failureReason: message },
      });
      if (outreach.contact.status === 'APPROVED') {
        await prisma.contact.update({
          where: { id: outreach.contactId },
          data: { status: 'FAILED' },
        });
      }
      logger.error({ outreachId, message }, '[Gmail] Send failed');
      if (error instanceof AppError) throw error;
      throw new AppError(502, message, 'SEND_FAILED');
    }
  });
}

async function deliverOutreach(
  draftId: string | null,
  message: { to: string; subject: string; body: string },
): Promise<string> {
  const realDraft = Boolean(draftId && !draftId.startsWith('test-draft:'));
  if (!realDraft) return sendPlainEmail(message);
  try {
    return await sendGmailDraft(draftId as string);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'DRAFT_MISSING') throw error;
    logger.warn('[Gmail] Stored draft is gone. Sending the saved message instead.');
    return sendPlainEmail(message);
  }
}

const SKIP_SEND_CODES = new Set([
  'OPTED_OUT',
  'DO_NOT_CONTACT',
  'NOT_APPROVED',
  'INVALID_EMAIL',
  'ALREADY_SENT',
  'ALREADY_CONTACTED',
  'ATTEMPT_LIMIT',
  'DAILY_LIMIT',
  'COOLDOWN',
  'STATUS',
  'DRAFT_MISSING',
  'TEST_MODE',
]);

export async function createDraftsBulk(contactIds: string[], templateId: string) {
  const template = await getTemplate(templateId);
  const known = await prisma.contact.findMany({
    where: { id: { in: contactIds } },
    select: { email: true },
  });
  const contactedEmails = await emailsAlreadyContacted(known.map((row) => row.email));
  const outreach = [];
  const failures: { contactId: string; username?: string; reason: string }[] = [];
  const skipped: { contactId: string; username?: string; email?: string; reason: string }[] = [];

  for (const contactId of contactIds) {
    try {
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (!contact) {
        skipped.push({ contactId, reason: 'Contact not found.' });
        continue;
      }
      if (contact.status === 'DO_NOT_CONTACT' || contact.status === 'OPTED_OUT' || contact.status === 'SENT' || contact.status === 'REPLIED') {
        skipped.push({ contactId, username: contact.username, email: contact.email, reason: contact.status });
        continue;
      }
      if (contactedEmails.has(normalizeEmail(contact.email))) {
        skipped.push({
          contactId,
          username: contact.username,
          email: contact.email,
          reason: 'This email address was already contacted.',
        });
        continue;
      }
      const decision = evaluateDraft({
        status: contact.status,
        email: contact.email,
        contactAttempts: contact.contactAttempts,
        maxContactAttempts: config.maxContactAttempts,
      });
      if (!decision.ok) {
        skipped.push({ contactId, username: contact.username, email: contact.email, reason: decision.message });
        continue;
      }
      const open = await prisma.outreach.findFirst({
        where: { contactId, status: { in: ['DRAFTED', 'APPROVED'] } },
        include: { contact: true },
      });
      if (open) {
        skipped.push({ contactId, username: contact.username, email: contact.email, reason: 'Already drafted' });
        continue;
      }
      const context = contextFromContact(contact);
      const renderedSubject = interpolate(template.subject, context);
      const renderedBody = interpolate(template.body, context);
      if (renderedSubject.missing.length || renderedBody.missing.length || hasUnresolved(renderedSubject.text) || hasUnresolved(renderedBody.text)) {
        failures.push({ contactId, username: contact.username, reason: 'Unresolved template fields.' });
        continue;
      }
      let gmailDraftId = `test-draft:${contactId}`;
      if (!config.outreachTestMode) {
        gmailDraftId = await createGmailDraft({
          to: contact.email,
          subject: renderedSubject.text,
          body: renderedBody.text,
        });
      }
      const row = await prisma.outreach.create({
        data: {
          contactId,
          templateId: template.id,
          subject: renderedSubject.text,
          body: renderedBody.text,
          status: 'DRAFTED',
          gmailDraftId,
        },
        include: { contact: true, template: { select: { id: true, name: true } } },
      });
      await prisma.contact.update({ where: { id: contactId }, data: { status: 'DRAFTED' } });
      outreach.push(row);
      logger.info({ contactId, outreachId: row.id, testMode: config.outreachTestMode }, '[Gmail] Draft created');
    } catch (error) {
      failures.push({
        contactId,
        reason: error instanceof Error ? error.message : 'Draft creation failed.',
      });
    }
  }

  return {
    success: true,
    testMode: config.outreachTestMode,
    created: outreach.length,
    failed: failures.length,
    skipped: skipped.length,
    outreach,
    failures,
    skippedItems: skipped,
  };
}

export async function approveOutreachBulk(outreachIds: string[]) {
  const approved = [];
  const skipped: { outreachId: string; reason: string }[] = [];
  for (const outreachId of outreachIds) {
    const outreach = await prisma.outreach.findUnique({
      where: { id: outreachId },
      include: { contact: true },
    });
    if (!outreach) {
      skipped.push({ outreachId, reason: 'Outreach message not found.' });
      continue;
    }
    if (outreach.contact.status === 'OPTED_OUT' || outreach.contact.status === 'DO_NOT_CONTACT') {
      skipped.push({ outreachId, reason: 'Do-not-contact.' });
      continue;
    }
    if (outreach.status !== 'DRAFTED' && outreach.status !== 'FAILED') {
      skipped.push({ outreachId, reason: `Cannot approve status ${outreach.status}.` });
      continue;
    }
    const reason = transitionError(outreach.contact.status, 'APPROVED');
    if (reason) {
      skipped.push({ outreachId, reason });
      continue;
    }
    const updated = await prisma.outreach.update({
      where: { id: outreachId },
      data: { status: 'APPROVED', approvedAt: new Date(), failureReason: null },
      include: { contact: true },
    });
    await prisma.contact.update({ where: { id: outreach.contactId }, data: { status: 'APPROVED' } });
    approved.push(updated);
  }
  return { success: true, approved: approved.length, skipped: skipped.length, outreach: approved, skippedItems: skipped };
}

export async function sendOutreachBulk(outreachIds: string[]) {
  const sent = [];
  const failed: { outreachId: string; reason: string }[] = [];
  const skipped: { outreachId: string; reason: string; code?: string }[] = [];
  for (const outreachId of outreachIds) {
    try {
      const updated = await sendOutreach(outreachId);
      sent.push(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Send failed.';
      const code = error instanceof AppError ? error.code : undefined;
      if (code && SKIP_SEND_CODES.has(code)) skipped.push({ outreachId, reason: message, code });
      else failed.push({ outreachId, reason: message });
    }
  }
  return {
    success: true,
    testMode: config.outreachTestMode,
    message: config.outreachTestMode ? 'TEST MODE — no email was sent.' : 'Batch send finished.',
    sent,
    failed,
    skipped,
  };
}

export async function sendPlacementTest(input: { templateId?: string; subject?: string; body?: string; to?: string }) {
  const credential = await prisma.googleCredential.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!credential) {
    throw new AppError(400, 'Connect Gmail before sending a placement test.', 'NOT_CONNECTED');
  }
  const limits = await getSendSettings();
  const requested = input.to?.trim() || limits.testRecipient || '';
  const checked = validateEmail(requested);
  if (!checked.ok) {
    throw new AppError(400, 'Enter the email address that should receive the test. Nothing was sent to the connected Gmail account.', 'INVALID_EMAIL');
  }
  const to = checked.email;

  let subject = input.subject?.trim() ?? '';
  let body = input.body?.trim() ?? '';
  if (!subject || !body) {
    if (!input.templateId) {
      throw new AppError(400, 'Choose a template before sending a placement test.', 'TEMPLATE');
    }
    const template = await getTemplate(input.templateId);
    const context = {
      name: 'Alex Rivera',
      first_name: 'Alex',
      username: 'alexrivera',
      email: to,
      github_url: 'https://github.com/alexrivera',
      bio: 'Builds developer tools',
      company: 'Example Studio',
      location: 'Remote',
      search_keyword: 'typescript',
    };
    const renderedSubject = interpolate(template.subject, context);
    const renderedBody = interpolate(template.body, context);
    if (
      renderedSubject.missing.length
      || renderedBody.missing.length
      || hasUnresolved(renderedSubject.text)
      || hasUnresolved(renderedBody.text)
    ) {
      throw new AppError(400, 'The template still has missing values, so the test was not sent.', 'TEMPLATE');
    }
    subject = renderedSubject.text;
    body = renderedBody.text;
  }

  if (config.outreachTestMode) {
    return {
      testMode: true,
      sent: false,
      to,
      subject,
      message: `Test mode is on, so nothing was delivered. Set OUTREACH_TEST_MODE=false in server/.env, restart, and send the test again to ${to}.`,
    };
  }

  await sendPlainEmail({ to, subject, body });
  logger.info({ email: maskEmail(to) }, '[Gmail] Placement test sent');
  return {
    testMode: false,
    sent: true,
    to,
    subject,
    message: `Sent one copy to ${to}. Check that inbox and its Spam folder. ${credential.accountEmail || 'The connected Gmail account'} only keeps a copy in Sent, and the To line on that copy is ${to}.`,
  };
}

export async function reopenDraftlessFailures(): Promise<number> {
  const rows = await prisma.outreach.findMany({
    where: {
      status: 'FAILED',
      OR: [
        { failureReason: { contains: 'no Gmail draft' } },
        { failureReason: { contains: 'draft no longer exists' } },
        { failureReason: { contains: 'Create the draft again' } },
        { failureReason: { contains: 'Create a new draft' } },
        { failureReason: { contains: 'kept this message as a draft' } },
      ],
    },
    select: { id: true, contactId: true },
  });
  for (const row of rows) {
    await prisma.outreach.update({
      where: { id: row.id },
      data: { status: 'APPROVED', failureReason: null, approvedAt: new Date() },
    });
    const contact = await prisma.contact.findUnique({ where: { id: row.contactId } });
    if (contact?.status === 'FAILED') {
      await prisma.contact.update({
        where: { id: row.contactId },
        data: { status: 'APPROVED' },
      });
    }
  }
  return rows.length;
}

export async function revertUnsentTestSends(): Promise<number> {
  const rows = await prisma.outreach.findMany({
    where: {
      status: 'SENT',
      OR: [
        { gmailMessageId: null },
        { gmailMessageId: { startsWith: 'test-mode:' } },
        { gmailMessageId: { startsWith: 'test-draft:' } },
      ],
    },
    select: { id: true, contactId: true, gmailDraftId: true },
  });
  let reopened = 0;
  for (const row of rows) {
    const hasRealDraft = Boolean(row.gmailDraftId && !row.gmailDraftId.startsWith('test-draft:'));
    await prisma.outreach.update({
      where: { id: row.id },
      data: {
        status: hasRealDraft ? 'APPROVED' : 'DRAFTED',
        sentAt: null,
        gmailMessageId: null,
        failureReason: null,
        approvedAt: hasRealDraft ? new Date() : null,
      },
    });
    const otherRealSends = await prisma.outreach.count({
      where: {
        contactId: row.contactId,
        status: 'SENT',
        gmailMessageId: { not: null },
        NOT: {
          OR: [
            { gmailMessageId: { startsWith: 'test-mode:' } },
            { gmailMessageId: { startsWith: 'test-draft:' } },
          ],
        },
      },
    });
    if (otherRealSends === 0) {
      const contact = await prisma.contact.findUnique({ where: { id: row.contactId } });
      if (contact && contact.status !== 'OPTED_OUT' && contact.status !== 'DO_NOT_CONTACT') {
        await prisma.contact.update({
          where: { id: row.contactId },
          data: {
            status: hasRealDraft ? 'APPROVED' : 'DRAFTED',
            contactAttempts: Math.max(0, contact.contactAttempts - 1),
            lastContactedAt: null,
          },
        });
      }
    }
    reopened += 1;
  }
  return reopened;
}
