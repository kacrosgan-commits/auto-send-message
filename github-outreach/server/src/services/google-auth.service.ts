import { randomBytes } from 'crypto';
import { google } from 'googleapis';
import { GMAIL_SCOPES, config } from '../config';
import { prisma } from '../lib/prisma';
import { decryptString, encryptString } from '../utils/crypto';
import { AppError } from '../utils/errors';
import { maskEmail } from '../utils/email';
import { logger } from '../utils/logger';
import { startOfLocalDay } from '../utils/send-policy';

const pendingStates = new Map<string, number>();

function oauthClient() {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  );
}

function requireGoogleConfig(): void {
  if (!config.googleConfigured) {
    throw new AppError(
      500,
      'Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to server/.env.',
      'OAUTH_NOT_CONFIGURED',
    );
  }
}

export function createAuthUrl(): string {
  requireGoogleConfig();
  const state = randomBytes(24).toString('hex');
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [...GMAIL_SCOPES],
    state,
    include_granted_scopes: true,
  });
}

export async function handleCallback(code: string, state: string | undefined, oauthError?: string): Promise<void> {
  requireGoogleConfig();
  if (oauthError) {
    throw new AppError(400, 'Google authorization was cancelled. Gmail is not connected.', 'OAUTH_DENIED');
  }
  const expires = state ? pendingStates.get(state) : undefined;
  if (state) pendingStates.delete(state);
  if (!expires || expires < Date.now()) {
    throw new AppError(400, 'Google authorization expired. Start the connection again.', 'OAUTH_STATE');
  }
  if (!code) {
    throw new AppError(400, 'Google did not return an authorization code.', 'OAUTH_CODE');
  }

  const client = oauthClient();
  let tokens;
  try {
    const response = await client.getToken(code);
    tokens = response.tokens;
  } catch (error) {
    logger.warn({ message: error instanceof Error ? error.message : 'token exchange failed' }, '[Auth] Token exchange failed');
    throw new AppError(400, 'Google authorization could not be completed. Try connecting again.', 'OAUTH_EXCHANGE');
  }

  if (!tokens.access_token) {
    throw new AppError(400, 'Google did not return an access token.', 'OAUTH_TOKEN');
  }

  const existing = await prisma.googleCredential.findFirst({ orderBy: { updatedAt: 'desc' } });
  const refreshToken =
    tokens.refresh_token || (existing ? decryptString(existing.refreshTokenEncrypted) : '');
  if (!refreshToken) {
    throw new AppError(
      400,
      'Google did not return a refresh token. Reconnect and allow offline access.',
      'OAUTH_REFRESH',
    );
  }

  client.setCredentials(tokens);
  const profile = google.oauth2({ version: 'v2', auth: client });
  const me = await profile.userinfo.get();
  const data = {
    accountEmail: me.data.email ?? null,
    accessTokenEncrypted: encryptString(tokens.access_token),
    refreshTokenEncrypted: encryptString(refreshToken),
    scope: tokens.scope ?? GMAIL_SCOPES.join(' '),
    expiresAt: new Date(tokens.expiry_date ?? Date.now() + 45 * 60 * 1000),
  };

  if (existing) {
    await prisma.googleCredential.update({ where: { id: existing.id }, data });
  } else {
    await prisma.googleCredential.create({ data });
  }

  logger.info(
    { email: data.accountEmail ? maskEmail(data.accountEmail) : 'unknown' },
    '[Auth] Google OAuth connected',
  );
}

async function persistRefreshedTokens(
  credentialId: string,
  tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null },
  currentRefresh: string,
): Promise<void> {
  if (!tokens.access_token) return;
  await prisma.googleCredential.update({
    where: { id: credentialId },
    data: {
      accessTokenEncrypted: encryptString(tokens.access_token),
      refreshTokenEncrypted: encryptString(tokens.refresh_token || currentRefresh),
      expiresAt: new Date(tokens.expiry_date ?? Date.now() + 45 * 60 * 1000),
    },
  });
}

export async function getAuthorizedClient() {
  const credential = await prisma.googleCredential.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!credential) {
    throw new AppError(401, 'Gmail is not connected.', 'NOT_CONNECTED');
  }

  const client = oauthClient();
  const refreshToken = decryptString(credential.refreshTokenEncrypted);
  client.setCredentials({
    access_token: decryptString(credential.accessTokenEncrypted),
    refresh_token: refreshToken,
    expiry_date: credential.expiresAt.getTime(),
  });

  client.on('tokens', (tokens) => {
    void persistRefreshedTokens(credential.id, tokens, refreshToken).catch((error: unknown) => {
      logger.error(
        { message: error instanceof Error ? error.message : 'token persist failed' },
        '[Auth] Could not store refreshed token',
      );
    });
  });

  if (credential.expiresAt.getTime() < Date.now() + 60_000) {
    try {
      await client.getAccessToken();
    } catch (error) {
      logger.warn(
        { message: error instanceof Error ? error.message : 'refresh failed' },
        '[Auth] OAuth refresh failed',
      );
      throw new AppError(401, 'Google authorization expired. Reconnect Gmail.', 'OAUTH_EXPIRED');
    }
  }

  return client;
}

export async function logout(): Promise<void> {
  const credential = await prisma.googleCredential.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!credential) return;
  try {
    await oauthClient().revokeToken(decryptString(credential.accessTokenEncrypted));
  } catch (error) {
    logger.warn(
      { message: error instanceof Error ? error.message : 'revoke failed' },
      '[Auth] Token revoke failed',
    );
  }
  await prisma.googleCredential.delete({ where: { id: credential.id } });
  logger.info('[Auth] Google OAuth disconnected');
}

export async function authStatus() {
  const credential = await prisma.googleCredential.findFirst({ orderBy: { updatedAt: 'desc' } });
  const sendsToday = await prisma.outreach.count({
    where: { status: 'SENT', sentAt: { gte: startOfLocalDay() } },
  });
  return {
    configured: config.googleConfigured,
    connected: Boolean(credential),
    email: credential?.accountEmail ?? null,
    expiresAt: credential?.expiresAt?.toISOString() ?? null,
    sendsToday,
    maxSendsPerDay: config.maxSendsPerDay,
    minSecondsBetweenSends: config.minSecondsBetweenSends,
    maxContactAttempts: config.maxContactAttempts,
  };
}
