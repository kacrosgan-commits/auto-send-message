import { google } from 'googleapis';
import { getAuthorizedClient } from './google-auth.service';
import { AppError, readErrorStatus } from '../utils/errors';
import { buildEncodedMime } from '../utils/gmail-message';
import { logger } from '../utils/logger';

function mapGmailError(error: unknown, fallback: string): AppError {
  if (error instanceof AppError) return error;
  const { status, message } = readErrorStatus(error);
  logger.warn({ status, message }, '[Gmail] API error');
  if (status === 401 || /invalid_grant|unauthorized|authError/i.test(message)) {
    return new AppError(401, 'Google authorization expired. Reconnect Gmail.', 'OAUTH_EXPIRED');
  }
  if (status === 429 || /rate limit|quota exceeded|userRateLimitExceeded/i.test(message)) {
    return new AppError(429, 'Gmail API rate limit reached. Wait and try again.', 'RATE_LIMIT');
  }
  if (/invalid to header|recipient address required|invalid recipient/i.test(message)) {
    return new AppError(400, 'Invalid recipient email.', 'INVALID_RECIPIENT');
  }
  if (status === 404 || /not found/i.test(message)) {
    return new AppError(404, 'The Gmail draft no longer exists. Create a new draft. Nothing was sent.', 'DRAFT_MISSING');
  }
  if (status === 400) {
    return new AppError(400, fallback, 'GMAIL_BAD_REQUEST');
  }
  return new AppError(502, fallback, 'GMAIL_ERROR');
}

export async function createGmailDraft(input: { to: string; subject: string; body: string }): Promise<string> {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildEncodedMime(input);
  try {
    const response = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw } },
    });
    const id = response.data.id;
    if (!id) {
      throw new AppError(502, 'Draft creation failed. Nothing was sent.', 'DRAFT_FAILED');
    }
    return id;
  } catch (error) {
    throw mapGmailError(error, 'Draft creation failed. Nothing was sent.');
  }
}

export async function sendGmailDraft(draftId: string): Promise<string> {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  try {
    const response = await gmail.users.drafts.send({
      userId: 'me',
      requestBody: { id: draftId },
    });
    const id = response.data.id;
    if (!id) {
      throw new AppError(502, 'Send failed. Gmail did not confirm the message.', 'SEND_FAILED');
    }
    await assertMessageWasSent(gmail, id, response.data.labelIds ?? []);
    return id;
  } catch (error) {
    throw mapGmailError(error, 'Send failed. The message was not confirmed as sent.');
  }
}

async function assertMessageWasSent(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  labelIds: string[],
): Promise<void> {
  let labels = labelIds;
  if (!labels.length) {
    try {
      const fetched = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'minimal',
      });
      labels = fetched.data.labelIds ?? [];
    } catch (error) {
      logger.warn(
        { message: error instanceof Error ? error.message : 'label check failed' },
        '[Gmail] Could not read labels after send',
      );
      return;
    }
  }
  if (labels.includes('DRAFT') && !labels.includes('SENT')) {
    throw new AppError(502, 'Gmail kept this message as a draft. It was not sent.', 'STILL_DRAFT');
  }
}

export async function sendPlainEmail(input: { to: string; subject: string; body: string }): Promise<string> {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildEncodedMime(input);
  try {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    const id = response.data.id;
    if (!id) {
      throw new AppError(502, 'Send failed. Gmail did not confirm the message.', 'SEND_FAILED');
    }
    return id;
  } catch (error) {
    throw mapGmailError(error, 'Send failed. The message was not confirmed as sent.');
  }
}
