import type { Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { mergeContactMetadata, planContactSave } from '../utils/contact-plan';
import { maskEmail, validateEmail } from '../utils/email';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { startOfLocalDay } from '../utils/send-policy';
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

export async function saveContact(input: ContactInput) {
  const emailResult = validateEmail(input.email);
  if (!emailResult.ok) {
    throw new AppError(400, emailResult.reason, 'INVALID_EMAIL');
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
      },
    });
    logger.info({ username: contact.username, email: maskEmail(contact.email) }, '[Contact] Duplicate skipped');
    return { contact, created: false, duplicate: true, message: 'Already in outreach' };
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
  logger.info({ username: contact.username, email: maskEmail(contact.email) }, '[Contact] Added');
  return { contact, created: true, duplicate: false, message: 'Added to outreach' };
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
    maxSendsPerDay: config.maxSendsPerDay,
    minSecondsBetweenSends: config.minSecondsBetweenSends,
    maxContactAttempts: config.maxContactAttempts,
  };
}
