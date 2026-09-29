import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3847),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z
    .string()
    .default('http://localhost:3847/api/auth/google/callback'),
  TOKEN_ENCRYPTION_KEY: z.string().min(16),
  MAX_SENDS_PER_DAY: z.coerce.number().int().positive().max(500).default(20),
  MIN_SECONDS_BETWEEN_SENDS: z.coerce.number().int().min(0).default(60),
  MAX_CONTACT_ATTEMPTS_PER_EMAIL: z.coerce.number().int().positive().max(5).default(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.string().default('development'),
  OUTREACH_TEST_MODE: z.enum(['true', 'false']).default('false'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration. ${details}`);
}

if (parsed.data.HOST !== '127.0.0.1' && parsed.data.HOST !== 'localhost') {
  throw new Error('HOST must stay on localhost. This server stores Gmail tokens.');
}

export const config = {
  port: parsed.data.PORT,
  host: parsed.data.HOST,
  databaseUrl: parsed.data.DATABASE_URL,
  googleClientId: parsed.data.GOOGLE_CLIENT_ID,
  googleClientSecret: parsed.data.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: parsed.data.GOOGLE_REDIRECT_URI,
  tokenEncryptionKey: parsed.data.TOKEN_ENCRYPTION_KEY,
  maxSendsPerDay: parsed.data.MAX_SENDS_PER_DAY,
  minSecondsBetweenSends: parsed.data.MIN_SECONDS_BETWEEN_SENDS,
  maxContactAttempts: parsed.data.MAX_CONTACT_ATTEMPTS_PER_EMAIL,
  logLevel: parsed.data.LOG_LEVEL,
  nodeEnv: parsed.data.NODE_ENV,
  outreachTestMode: parsed.data.OUTREACH_TEST_MODE === 'true',
  googleConfigured: Boolean(parsed.data.GOOGLE_CLIENT_ID && parsed.data.GOOGLE_CLIENT_SECRET),
};

export const GMAIL_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
] as const;
