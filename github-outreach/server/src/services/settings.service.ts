import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
const SEND_SETTINGS_MIGRATION = '20260929020000_send_settings';

let sendSettingsReady: Promise<void> | null = null;

export function ensureSendSettingsTable(): Promise<void> {
  if (!sendSettingsReady) {
    sendSettingsReady = createSendSettingsTable().catch((error: unknown) => {
      sendSettingsReady = null;
      throw error;
    });
  }
  return sendSettingsReady;
}

async function createSendSettingsTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SendSettings" (
      "id" INTEGER NOT NULL PRIMARY KEY,
      "maxSendsPerDay" INTEGER NOT NULL,
      "minSecondsBetweenSends" INTEGER NOT NULL,
      "testRecipient" TEXT NOT NULL DEFAULT '',
      "updatedAt" DATETIME NOT NULL
    )
  `);
  try {
    await recordSendSettingsMigration();
  } catch (error) {
    logger.warn(
      { message: error instanceof Error ? error.message : 'migration record failed' },
      '[Settings] SendSettings table is ready, but the migration row was not recorded',
    );
  }
}

async function recordSendSettingsMigration(): Promise<void> {
  const migrationFile = path.resolve(__dirname, '../../prisma/migrations', SEND_SETTINGS_MIGRATION, 'migration.sql');
  if (!fs.existsSync(migrationFile)) return;
  const existing = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ${SEND_SETTINGS_MIGRATION}
  `;
  if (existing.length > 0) return;
  const checksum = createHash('sha256').update(fs.readFileSync(migrationFile)).digest('hex');
  const now = new Date().toISOString();
  await prisma.$executeRaw`
    INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
    VALUES (${randomUUID()}, ${checksum}, ${now}, ${SEND_SETTINGS_MIGRATION}, ${null}, ${null}, ${now}, ${1})
  `;
}

function fallbackSettings(): SendSettingsView {
  return {
    maxSendsPerDay: config.maxSendsPerDay,
    minSecondsBetweenSends: config.minSecondsBetweenSends,
    testRecipient: '',
  };
}

export async function getSendSettings(): Promise<SendSettingsView> {
  try {
    await ensureSendSettingsTable();
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
  await ensureSendSettingsTable();
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
  const data = {
    maxSendsPerDay: input.maxSendsPerDay ?? current.maxSendsPerDay,
    minSecondsBetweenSends: input.minSecondsBetweenSends ?? current.minSecondsBetweenSends,
    testRecipient,
  };
  try {
    const updated = await writeSendSettings(data);
    return toView(updated);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'settings update failed';
    logger.error({ message: detail }, '[Settings] Update failed');
    const missingTable = /no such table|does not exist/i.test(detail);
    throw new AppError(
      500,
      missingTable
        ? `Send settings could not be saved. ${MIGRATE_HINT}`
        : 'Send timing could not be saved. Wait a moment and click Save timing again.',
      'DATABASE',
    );
  }
}

async function writeSendSettings(data: {
  maxSendsPerDay: number;
  minSecondsBetweenSends: number;
  testRecipient: string;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.sendSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : '';
      if (!/busy|locked/i.test(message) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError;
}

function toView(row: { maxSendsPerDay: number; minSecondsBetweenSends: number; testRecipient: string }): SendSettingsView {
  return {
    maxSendsPerDay: row.maxSendsPerDay,
    minSecondsBetweenSends: row.minSecondsBetweenSends,
    testRecipient: row.testRecipient,
  };
}
