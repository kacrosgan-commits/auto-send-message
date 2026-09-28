import type { ContactStatus, OutreachStatus } from '../types';
import { validateEmail } from './email';
import { isDoNotContact } from './status';

export interface SendCheckInput {
  outreachStatus: OutreachStatus;
  contactStatus: ContactStatus;
  email: string | null;
  alreadySent: boolean;
  sendsToday: number;
  maxSendsPerDay: number;
  lastSentAt: Date | null;
  minSecondsBetweenSends: number;
  contactAttempts: number;
  maxContactAttempts: number;
  now?: Date;
}

export type PolicyResult = { ok: true } | { ok: false; message: string; code: string };

export function evaluateSend(input: SendCheckInput): PolicyResult {
  const now = input.now ?? new Date();

  if (input.contactStatus === 'OPTED_OUT') {
    return {
      ok: false,
      code: 'OPTED_OUT',
      message: 'This person opted out. Sending is disabled.',
    };
  }
  if (input.contactStatus === 'DO_NOT_CONTACT') {
    return {
      ok: false,
      code: 'DO_NOT_CONTACT',
      message: 'This person is marked do-not-contact. Sending is disabled.',
    };
  }
  if (input.outreachStatus !== 'APPROVED' || input.contactStatus !== 'APPROVED') {
    return {
      ok: false,
      code: 'NOT_APPROVED',
      message: 'Only approved messages can be sent.',
    };
  }
  const email = validateEmail(input.email ?? '');
  if (!email.ok) {
    return {
      ok: false,
      code: 'INVALID_EMAIL',
      message: 'This contact does not have a valid public email.',
    };
  }
  if (input.alreadySent) {
    return {
      ok: false,
      code: 'ALREADY_SENT',
      message: 'This message has already been sent.',
    };
  }
  if (input.contactAttempts >= input.maxContactAttempts) {
    return {
      ok: false,
      code: 'ATTEMPT_LIMIT',
      message: 'This email has already been contacted the maximum number of times.',
    };
  }
  if (input.sendsToday >= input.maxSendsPerDay) {
    return {
      ok: false,
      code: 'DAILY_LIMIT',
      message: `Daily send limit reached (${input.maxSendsPerDay}).`,
    };
  }
  if (input.lastSentAt) {
    const elapsedSeconds = (now.getTime() - input.lastSentAt.getTime()) / 1000;
    if (elapsedSeconds < input.minSecondsBetweenSends) {
      const wait = Math.ceil(input.minSecondsBetweenSends - elapsedSeconds);
      return {
        ok: false,
        code: 'COOLDOWN',
        message: `Cooldown active. Wait ${wait}s before sending another email.`,
      };
    }
  }
  return { ok: true };
}

export function evaluateDraft(input: {
  status: ContactStatus;
  email: string | null;
  contactAttempts: number;
  maxContactAttempts: number;
}): PolicyResult {
  if (isDoNotContact(input.status)) {
    return {
      ok: false,
      code: 'DO_NOT_CONTACT',
      message:
        input.status === 'OPTED_OUT'
          ? 'This person opted out. Drafts are disabled.'
          : 'This person is marked do-not-contact. Drafts are disabled.',
    };
  }
  const email = validateEmail(input.email ?? '');
  if (!email.ok) {
    return { ok: false, code: 'INVALID_EMAIL', message: email.reason };
  }
  if (input.contactAttempts >= input.maxContactAttempts) {
    return {
      ok: false,
      code: 'ATTEMPT_LIMIT',
      message: 'This email has already been contacted the maximum number of times.',
    };
  }
  if (input.status === 'APPROVED' || input.status === 'SENT' || input.status === 'REPLIED') {
    return {
      ok: false,
      code: 'DRAFT_BLOCKED',
      message: 'Finish the current outreach before creating another draft.',
    };
  }
  return { ok: true };
}

export function startOfLocalDay(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
