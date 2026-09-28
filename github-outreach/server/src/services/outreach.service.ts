import type { OutreachStatus } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { createGmailDraft, sendGmailDraft } from './gmail.service';
import { AppError } from '../utils/errors';
import { maskEmail, validateEmail } from '../utils/email';
import { logger } from '../utils/logger';
import { evaluateDraft, evaluateSend, startOfLocalDay } from '../utils/send-policy';
import { transitionError } from '../utils/status';
import { hasUnresolved } from '../utils/template';

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

    const decision = evaluateSend({
      outreachStatus: outreach.status,
      contactStatus: outreach.contact.status,
      email: outreach.contact.email,
      alreadySent: Boolean(outreach.sentAt || outreach.gmailMessageId || outreach.status === 'SENT'),
      sendsToday,
      maxSendsPerDay: config.maxSendsPerDay,
      lastSentAt: lastSent?.sentAt ?? null,
      minSecondsBetweenSends: config.minSecondsBetweenSends,
      contactAttempts: outreach.contact.contactAttempts,
      maxContactAttempts: config.maxContactAttempts,
    });
    if (!decision.ok) throw new AppError(400, decision.message, decision.code);
    if (!outreach.gmailDraftId) {
      throw new AppError(400, 'This message has no Gmail draft to send.', 'DRAFT_MISSING');
    }

    try {
      const gmailMessageId = await sendGmailDraft(outreach.gmailDraftId);
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
