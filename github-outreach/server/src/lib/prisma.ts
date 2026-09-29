import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function resolveSqliteDatabase(): string {
  const raw = (process.env.DATABASE_URL || 'file:./outreach.db').replace(/^["']|["']$/g, '');
  const filePart = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
  const absolute = path.isAbsolute(filePart)
    ? filePart
    : path.resolve(__dirname, '../../prisma', filePart.replace(/^\.\//, ''));
  process.env.DATABASE_URL = `file:${absolute}`;
  return absolute;
}

export const sqliteDatabasePath = resolveSqliteDatabase();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function configureSqlite(): Promise<void> {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000');
}
