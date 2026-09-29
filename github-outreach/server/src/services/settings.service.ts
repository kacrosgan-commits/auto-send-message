import { config } from '../config';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/errors';
import { validateEmail } from '../utils/email';
import { logger } from '../utils/logger';

export interface SendSettingsView {
  maxSendsPerDay: number;
  minSecondsBetweenSends: number;
  testRecipient: string;
}

const MIGRATE_HINT = 'From github-outreach/server run: npx prisma migrate deploy';

function fallbackSettings(): SendSettingsView {
  return {
    maxSendsPerDay: config.maxSendsPerDay,
    minSecondsBetweenSends: config.minSecondsBetweenSends,
    testRecipient: '',
  };
}

export async function getSendSettings(): Promise<SendSettingsView> {
  try {
    const existing = await prisma.sendSettings.findUnique({ where: { id: 1 } });
    if (existing) return toView(existing);
    const created = await prisma.sendSettings.create({
      data: {
        id: 1,
        maxSendsPerDay: config.maxSendsPerDay,
        minSecondsBetweenSends: config.minSecondsBetweenSends,
        testRecipient: '',
      },
    });
    return toView(created);
  } catch (error) {
    logger.warn({ message: error instanceof Error ? error.message : 'settings unavailable' }, '[Settings] Using .env limits');
    return fallbackSettings();
  }
}

export async function updateSendSettings(input: {
  maxSendsPerDay?: number;
  minSecondsBetweenSends?: number;
  testRecipient?: string;
}): Promise<SendSettingsView> {
  const current = await getSendSettings();
  let testRecipient = current.testRecipient;
  if (input.testRecipient !== undefined) {
    const trimmed = input.testRecipient.trim();
    if (trimmed) {
      const email = validateEmail(trimmed);
      if (!email.ok) throw new AppError(400, email.reason, 'INVALID_EMAIL');
      testRecipient = email.email;
    } else {
      testRecipient = '';
    }
  }
  try {
    const updated = await prisma.sendSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        maxSendsPerDay: input.maxSendsPerDay ?? current.maxSendsPerDay,
        minSecondsBetweenSends: input.minSecondsBetweenSends ?? current.minSecondsBetweenSends,
        testRecipient,
      },
      update: {
        maxSendsPerDay: input.maxSendsPerDay ?? current.maxSendsPerDay,
        minSecondsBetweenSends: input.minSecondsBetweenSends ?? current.minSecondsBetweenSends,
        testRecipient,
      },
    });
    return toView(updated);
  } catch (error) {
    logger.error({ message: error instanceof Error ? error.message : 'settings update failed' }, '[Settings] Update failed');
    throw new AppError(500, `Send settings could not be saved. ${MIGRATE_HINT}`, 'DATABASE');
  }
}

function toView(row: { maxSendsPerDay: number; minSecondsBetweenSends: number; testRecipient: string }): SendSettingsView {
  return {
    maxSendsPerDay: row.maxSendsPerDay,
    minSecondsBetweenSends: row.minSecondsBetweenSends,
    testRecipient: row.testRecipient,
  };
}
