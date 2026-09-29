import type { Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { mergeContactMetadata, planContactSave } from '../utils/contact-plan';
import { maskEmail, normalizeEmail, validateEmail } from '../utils/email';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { contactRecordWasContacted, startOfLocalDay } from '../utils/send-policy';
import { getSendSettings } from './settings.service';
import { isDoNotContact, transitionError } from '../utils/status';
import type { ContactStatus } from '../types';

export interface ContactInput {
  username: string;
  displayName?: string | null;
  email: string;
  githubUrl: string;
  avatarUrl?: string | null;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  searchKeyword?: string | null;
  source?: string | null;
}

export interface ContactFilters {
  status?: ContactStatus;
  q?: string;
  searchKeyword?: string;
  company?: string;
  location?: string;
  username?: string;
  hasEmail?: 'true' | 'false';
  from?: string;
  to?: string;
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function optionalHttpUrl(value: unknown): string | null {
  const raw = optionalText(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeContactPayload(body: unknown): ContactInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'Request body must be a JSON object.', 'VALIDATION', [
      { path: 'body', message: 'Request body must be a JSON object.' },
    ]);
  }
  const raw = body as Record<string, unknown>;
  let username = typeof raw.username === 'string' ? raw.username.trim() : '';
  const email = typeof raw.email === 'string' ? raw.email.trim() : '';
  let githubUrl = typeof raw.githubUrl === 'string' ? raw.githubUrl.trim() : '';
  const fromUrl = githubUrl.match(/github\.com\/([A-Za-z0-9-]{1,39})/i)?.[1] ?? '';
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(username) && fromUrl) username = fromUrl;
  if (fromUrl) githubUrl = `https://github.com/${fromUrl}`;
  else if (username) githubUrl = `https://github.com/${username}`;
  const details: { path: string; message: string }[] = [];

  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(username)) {
    details.push({ path: 'username', message: 'Enter a valid GitHub username.' });
  }
  if (!email) {
    details.push({ path: 'email', message: 'Email is required.' });
  }
  if (!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/?$/.test(githubUrl)) {
    details.push({ path: 'githubUrl', message: 'GitHub profile URL is required.' });
  }
  if (details.length) {
    throw new AppError(
      400,
      details.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
      'VALIDATION',
      details,
    );
  }

  return {
    username,
    email,
    githubUrl,
    displayName: optionalText(raw.displayName, 200),
    avatarUrl: optionalHttpUrl(raw.avatarUrl),
    bio: optionalText(raw.bio, 4000),
    location: optionalText(raw.location, 200),
    company: optionalText(raw.company, 200),
    searchKeyword: optionalText(raw.searchKeyword, 200),
    source: 'github',
  };
}

export async function saveContact(input: ContactInput) {
  const emailResult = validateEmail(input.email);
  if (!emailResult.ok) {
    throw new AppError(400, emailResult.reason, 'VALIDATION', [
      { path: 'email', message: emailResult.reason },
    ]);
  }

  const incoming = {
    username: input.username.trim(),
    displayName: emptyToNull(input.displayName),
    email: emailResult.email,
    githubUrl: input.githubUrl.trim(),
    avatarUrl: emptyToNull(input.avatarUrl),
    bio: emptyToNull(input.bio),
    company: emptyToNull(input.company),
    location: emptyToNull(input.location),
    searchKeyword: emptyToNull(input.searchKeyword),
    source: 'github',
    status: 'NEW',
  };

  const existing = await prisma.contact.findUnique({ where: { email: incoming.email } });
  const action = planContactSave(existing?.email ?? null);

  if (existing && action === 'update') {
    const merged = mergeContactMetadata(
      {
        username: existing.username,
        displayName: existing.displayName,
        email: existing.email,
        githubUrl: existing.githubUrl,
        avatarUrl: existing.avatarUrl,
        bio: existing.bio,
        company: existing.company,
        location: existing.location,
        searchKeyword: existing.searchKeyword,
        source: existing.source,
        status: existing.status,
      },
      incoming,
    );
    const reopened = await shouldReopenUndelivered(existing);
    const contact = await prisma.contact.update({
      where: { id: existing.id },
      data: {
        username: merged.username,
        displayName: merged.displayName,
        githubUrl: merged.githubUrl,
        avatarUrl: merged.avatarUrl,
        bio: merged.bio,
        company: merged.company,
        location: merged.location,
        searchKeyword: merged.searchKeyword,
        ...(reopened ? { status: 'NEW' } : {}),
      },
    });
    logger.info({ contactId: contact.id, reopened }, `[Contacts] Existing contact id=${contact.id}`);
    return {
      success: true,
      contact,
      created: false,
      duplicate: !reopened,
      reopened,
      message: reopened ? 'Moved back to ready. The earlier send never went out.' : 'Already in outreach',
    };
  }

  const contact = await prisma.contact.create({
    data: {
      username: incoming.username,
      displayName: incoming.displayName,
      email: incoming.email,
      githubUrl: incoming.githubUrl,
      avatarUrl: incoming.avatarUrl,
      bio: incoming.bio,
      company: incoming.company,
      location: incoming.location,
      searchKeyword: incoming.searchKeyword,
      source: 'github',
    },
  });
  logger.info({ contactId: contact.id }, `[Contacts] Contact persisted id=${contact.id}`);
  return { success: true, contact, created: true, duplicate: false, message: 'Added to outreach' };
}

export async function saveContactsBulk(items: unknown[]) {
  const contacts = [];
  let created = 0;
  let duplicates = 0;
  let skipped = 0;
  const skippedItems: { index: number; reason: string }[] = [];

  for (let index = 0; index < items.length; index += 1) {
    try {
      const input = normalizeContactPayload(items[index]);
      const result = await saveContact(input);
      contacts.push(result.contact);
      if (result.created) created += 1;
      else duplicates += 1;
    } catch (error) {
      skipped += 1;
      skippedItems.push({
        index,
        reason: error instanceof Error ? error.message : 'Contact was skipped.',
      });
    }
  }

  return { success: true, created, duplicates, skipped, contacts, skippedItems };
}

async function shouldReopenUndelivered(contact: {
  id: string;
  status: string;
  contactAttempts: number;
  lastContactedAt: Date | null;
}): Promise<boolean> {
  if (contact.status !== 'FAILED' || contact.contactAttempts > 0 || contact.lastContactedAt) return false;
  const sent = await prisma.outreach.findMany({
    where: { contactId: contact.id, status: 'SENT' },
    select: { gmailMessageId: true },
  });
  return !contactRecordWasContacted({
    status: contact.status,
    contactAttempts: contact.contactAttempts,
    lastContactedAt: contact.lastContactedAt,
    sentMessageIds: sent.map((row) => row.gmailMessageId),
  });
}

export async function reopenUndeliveredFailures(): Promise<number> {
  const failed = await prisma.contact.findMany({
    where: { status: 'FAILED', contactAttempts: 0, lastContactedAt: null },
    select: { id: true, status: true, contactAttempts: true, lastContactedAt: true },
  });
  const ids: string[] = [];
  for (const contact of failed) {
    if (await shouldReopenUndelivered(contact)) ids.push(contact.id);
  }
  if (!ids.length) return 0;
  await prisma.contact.updateMany({
    where: { id: { in: ids } },
    data: { status: 'NEW' },
  });
  return ids.length;
}

export async function emailsAlreadyContacted(emails: string[]): Promise<Set<string>> {
  const normalized = [...new Set(emails.map((email) => normalizeEmail(email)).filter(Boolean))];
  if (!normalized.length) return new Set();
  const contacts = await prisma.contact.findMany({
    where: { email: { in: normalized } },
    select: {
      email: true,
      status: true,
      contactAttempts: true,
      lastContactedAt: true,
      outreaches: {
        where: { status: 'SENT' },
        select: { gmailMessageId: true },
      },
    },
  });
  const contacted = new Set<string>();
  for (const contact of contacts) {
    if (
      contactRecordWasContacted({
        status: contact.status,
        contactAttempts: contact.contactAttempts,
        lastContactedAt: contact.lastContactedAt,
        sentMessageIds: contact.outreaches.map((row) => row.gmailMessageId),
      })
    ) {
      contacted.add(normalizeEmail(contact.email));
    }
  }
  return contacted;
}

export async function listContacts(filters: ContactFilters) {
  const where: Prisma.ContactWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.searchKeyword) where.searchKeyword = { contains: filters.searchKeyword };
  if (filters.company) where.company = { contains: filters.company };
  if (filters.location) where.location = { contains: filters.location };
  if (filters.username) where.username = { contains: filters.username };
  if (filters.hasEmail === 'true') where.NOT = { email: '' };
  if (filters.hasEmail === 'false') where.email = '';
  if (filters.q) {
    const q = filters.q.trim();
    where.OR = [
      { displayName: { contains: q } },
      { username: { contains: q } },
      { email: { contains: q.toLowerCase() } },
    ];
  }
  if (filters.from || filters.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.from) createdAt.gte = new Date(`${filters.from}T00:00:00`);
    if (filters.to) createdAt.lte = new Date(`${filters.to}T23:59:59.999`);
    where.createdAt = createdAt;
  }

  return prisma.contact.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
}

export async function getContact(id: string) {
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: { outreaches: { orderBy: { createdAt: 'desc' } } },
  });
  if (!contact) throw new AppError(404, 'Contact not found.', 'NOT_FOUND');
  return contact;
}

export async function updateContact(id: string, status: ContactStatus) {
  const contact = await getContact(id);
  if (!['DO_NOT_CONTACT', 'OPTED_OUT', 'REPLIED'].includes(status)) {
    throw new AppError(400, 'That status can only be changed by the outreach workflow.', 'STATUS');
  }
  const reason = transitionError(contact.status, status);
  if (reason) throw new AppError(400, reason, 'STATUS');
  if (isDoNotContact(contact.status)) {
    throw new AppError(400, 'Do-not-contact status cannot be changed back.', 'STATUS');
  }
  const updated = await prisma.contact.update({ where: { id }, data: { status } });
  logger.info({ contactId: id, status }, '[Contact] Status updated');
  return updated;
}

export async function deleteContact(id: string) {
  await getContact(id);
  await prisma.contact.delete({ where: { id } });
  logger.info({ contactId: id }, '[Contact] Deleted');
}

export async function listContactedAddresses(): Promise<{ emails: string[]; usernames: string[] }> {
  const contacts = await prisma.contact.findMany({
    where: {
      OR: [
        { status: { in: ['SENT', 'REPLIED', 'DO_NOT_CONTACT', 'OPTED_OUT'] } },
        { contactAttempts: { gt: 0 } },
        { lastContactedAt: { not: null } },
        {
          outreaches: {
            some: {
              status: 'SENT',
              gmailMessageId: { not: null },
              NOT: {
                OR: [
                  { gmailMessageId: { startsWith: 'test-mode:' } },
                  { gmailMessageId: { startsWith: 'test-draft:' } },
                ],
              },
            },
          },
        },
      ],
    },
    select: { email: true, username: true },
    take: 5000,
  });
  return {
    emails: contacts.map((row) => normalizeEmail(row.email)).filter(Boolean),
    usernames: contacts.map((row) => row.username.trim().toLowerCase()).filter(Boolean),
  };
}

export async function lookupContacts(emails: string[], usernames: string[]) {
  const normalizedEmails = emails
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 100);
  const normalizedUsers = usernames.map((name) => name.trim()).filter(Boolean).slice(0, 100);
  if (!normalizedEmails.length && !normalizedUsers.length) return [];

  return prisma.contact.findMany({
    where: {
      OR: [
        ...(normalizedEmails.length ? [{ email: { in: normalizedEmails } }] : []),
        ...(normalizedUsers.length ? [{ username: { in: normalizedUsers } }] : []),
      ],
    },
    select: { id: true, email: true, username: true, status: true },
  });
}

export async function getSummary() {
  const grouped = await prisma.contact.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all])) as Partial<
    Record<ContactStatus, number>
  >;
  const total = grouped.reduce((sum, row) => sum + row._count._all, 0);
  const doNotContact = (counts.DO_NOT_CONTACT ?? 0) + (counts.OPTED_OUT ?? 0);
  const sendsToday = await prisma.outreach.count({
    where: { status: 'SENT', sentAt: { gte: startOfLocalDay() } },
  });
  const limits = await getSendSettings();
  return {
    total,
    ready: counts.NEW ?? 0,
    drafted: counts.DRAFTED ?? 0,
    approved: counts.APPROVED ?? 0,
    sent: counts.SENT ?? 0,
    replied: counts.REPLIED ?? 0,
    failed: counts.FAILED ?? 0,
    doNotContact,
    optedOut: counts.OPTED_OUT ?? 0,
    sendsToday,
    maxSendsPerDay: limits.maxSendsPerDay,
    minSecondsBetweenSends: limits.minSecondsBetweenSends,
    testRecipient: limits.testRecipient,
    maxContactAttempts: config.maxContactAttempts,
  };
}
