import { describe, expect, it } from 'vitest';
import { emailsMatch, maskEmail, normalizeEmail, validateEmail } from '../src/utils/email';
import { mergeContactMetadata, planContactSave } from '../src/utils/contact-plan';
import { buildEncodedMime, buildPlainTextMime } from '../src/utils/gmail-message';
import { contactRecordWasContacted, evaluateDraft, evaluateSend } from '../src/utils/send-policy';
import { canTransition, transitionError } from '../src/utils/status';
import { contextFromContact, extractFirstName, hasUnresolved, interpolate } from '../src/utils/template';

const baseContact = {
  displayName: 'John Smith',
  username: 'jsmith',
  email: 'john@example.com',
  githubUrl: 'https://github.com/jsmith',
  bio: 'Builds tools',
  company: 'Example',
  location: 'Remote',
  searchKeyword: 'full stack',
};

describe('email normalization', () => {
  it('trims and lowercases addresses', () => {
    expect(normalizeEmail('  User@Example.com ')).toBe('user@example.com');
    expect(emailsMatch('User@Example.com', ' user@example.com ')).toBe(true);
  });

  it('rejects malformed and GitHub noreply addresses', () => {
    expect(validateEmail('not-an-email').ok).toBe(false);
    expect(validateEmail('dev@users.noreply.github.com').ok).toBe(false);
    expect(validateEmail('dev@noreply.github.com').ok).toBe(false);
    expect(validateEmail(' 3222Superstar@Gmail.com ').ok && validateEmail('3222Superstar@Gmail.com')).toMatchObject({
      ok: true,
      email: '3222superstar@gmail.com',
    });
  });

  it('masks the local part in logs', () => {
    expect(maskEmail('john@example.com')).toBe('j***@example.com');
  });
});

describe('duplicate prevention', () => {
  it('updates metadata for an existing normalized email and keeps status', () => {
    expect(planContactSave('user@example.com')).toBe('update');
    expect(planContactSave(null)).toBe('create');
    const merged = mergeContactMetadata(
      {
        username: 'old',
        displayName: 'Old Name',
        email: 'user@example.com',
        githubUrl: 'https://github.com/old',
        avatarUrl: null,
        bio: 'Old bio',
        company: null,
        location: null,
        searchKeyword: 'react',
        source: 'github',
        status: 'DRAFTED',
      },
      {
        username: 'newname',
        displayName: 'New Name',
        email: 'USER@example.com',
        githubUrl: 'https://github.com/newname',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1',
        bio: 'New bio',
        company: 'Acme',
        location: 'Berlin',
        searchKeyword: 'full stack',
        source: 'github',
        status: 'NEW',
      },
    );
    expect(merged.email).toBe('user@example.com');
    expect(merged.status).toBe('DRAFTED');
    expect(merged.username).toBe('newname');
    expect(merged.bio).toBe('New bio');
  });
});

describe('template interpolation and first names', () => {
  it('uses a real first name and falls back for job titles', () => {
    expect(extractFirstName('John Smith')).toBe('John');
    expect(extractFirstName('Senior Full Stack Engineer')).toBe('there');
    expect(extractFirstName('Senior AI Full Stack Engineer')).toBe('there');
    expect(extractFirstName('Dr. Jane Roe')).toBe('Jane');
    expect(extractFirstName('')).toBe('there');
    expect(extractFirstName(null)).toBe('there');
  });

  it('fills variables and reports unresolved ones', () => {
    const context = contextFromContact(baseContact);
    const result = interpolate('Hi {{first_name}}, I saw {{search_keyword}} at {{company}}.', context);
    expect(result.text).toBe('Hi John, I saw full stack at Example.');
    expect(result.missing).toEqual([]);
    expect(hasUnresolved(result.text)).toBe(false);
  });

  it('supports default filters and highlights missing values', () => {
    const context = contextFromContact({ ...baseContact, displayName: 'Senior AI Full Stack Engineer', bio: null });
    const named = interpolate('Hi {{first_name | default:"there"}},', context);
    expect(named.text).toBe('Hi there,');
    const missing = interpolate('About {{bio}}', context);
    expect(missing.missing).toContain('bio');
    expect(hasUnresolved(missing.text)).toBe(true);
    const fallback = interpolate('About {{bio | default:"your work"}}', context);
    expect(fallback.text).toBe('About your work');
    expect(fallback.missing).toEqual([]);
  });
});

describe('status transitions', () => {
  it('requires approval before send', () => {
    expect(canTransition('NEW', 'DRAFTED')).toBe(true);
    expect(canTransition('DRAFTED', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'SENT')).toBe(true);
    expect(canTransition('APPROVED', 'FAILED')).toBe(true);
    expect(canTransition('FAILED', 'APPROVED')).toBe(true);
    expect(canTransition('NEW', 'SENT')).toBe(false);
    expect(canTransition('DRAFTED', 'SENT')).toBe(false);
    expect(transitionError('DRAFTED', 'SENT')).toMatch(/approved/i);
    expect(canTransition('DO_NOT_CONTACT', 'DRAFTED')).toBe(false);
    expect(canTransition('OPTED_OUT', 'SENT')).toBe(false);
  });
});

describe('send approval and safety limits', () => {
  const ready = {
    outreachStatus: 'APPROVED' as const,
    contactStatus: 'APPROVED' as const,
    email: 'john@example.com',
    alreadySent: false,
    sendsToday: 0,
    maxSendsPerDay: 20,
    lastSentAt: null,
    minSecondsBetweenSends: 60,
    contactAttempts: 0,
    maxContactAttempts: 1,
    now: new Date('2026-09-28T12:00:00Z'),
  };

  it('allows one approved send and blocks skipped approval', () => {
    expect(evaluateSend(ready).ok).toBe(true);
    expect(evaluateSend({ ...ready, outreachStatus: 'DRAFTED', contactStatus: 'DRAFTED' }).ok).toBe(false);
    expect(evaluateSend({ ...ready, outreachStatus: 'DRAFTED', contactStatus: 'NEW' }).code).toBe('NOT_APPROVED');
    expect(evaluateSend({ ...ready, outreachStatus: 'FAILED', contactStatus: 'FAILED' }).ok).toBe(false);
  });

  it('blocks do-not-contact, duplicates, the daily limit, and cooldown', () => {
    expect(evaluateDraft({ status: 'DO_NOT_CONTACT', email: 'john@example.com', contactAttempts: 0, maxContactAttempts: 1 }).ok).toBe(false);
    expect(evaluateDraft({ status: 'OPTED_OUT', email: 'john@example.com', contactAttempts: 0, maxContactAttempts: 1 }).code).toBe('DO_NOT_CONTACT');
    expect(evaluateSend({ ...ready, contactStatus: 'DO_NOT_CONTACT' }).code).toBe('DO_NOT_CONTACT');
    expect(evaluateSend({ ...ready, contactStatus: 'OPTED_OUT' }).code).toBe('OPTED_OUT');
    expect(contactRecordWasContacted({ status: 'NEW', contactAttempts: 0, lastContactedAt: null })).toBe(false);
    expect(contactRecordWasContacted({ status: 'SENT', contactAttempts: 1, lastContactedAt: new Date() })).toBe(true);
    expect(contactRecordWasContacted({ status: 'NEW', contactAttempts: 0, lastContactedAt: null, sentMessageIds: ['test-mode:1'] })).toBe(false);
    expect(contactRecordWasContacted({ status: 'APPROVED', contactAttempts: 0, lastContactedAt: null, sentMessageIds: ['18c5real'] })).toBe(true);
    expect(evaluateSend({ ...ready, alreadySent: true }).code).toBe('ALREADY_SENT');
    expect(evaluateSend({ ...ready, contactAttempts: 1 }).code).toBe('ATTEMPT_LIMIT');
    expect(evaluateSend({ ...ready, sendsToday: 20 }).code).toBe('DAILY_LIMIT');
    expect(evaluateSend({ ...ready, lastSentAt: new Date('2026-09-28T11:59:30Z') }).code).toBe('COOLDOWN');
    expect(evaluateSend({ ...ready, lastSentAt: new Date('2026-09-28T11:58:00Z') }).ok).toBe(true);
  });
});

describe('Gmail MIME generation', () => {
  it('builds a plain-text message and base64url payload', () => {
    const mime = buildPlainTextMime({
      to: 'john@example.com',
      subject: 'Quick question\r\nBcc: evil@example.com',
      body: 'Hi John,\nHello.',
    });
    expect(mime.startsWith('To: john@example.com\r\n')).toBe(true);
    expect(mime).toContain('Subject: Quick question Bcc: evil@example.com');
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('\r\n\r\nHi John,\r\nHello.');
    expect(mime).not.toContain('\r\nBcc:');
    const encoded = buildEncodedMime({ to: 'john@example.com', subject: 'Hello', body: 'Hi there' });
    expect(encoded).not.toMatch(/[+/=]/);
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toContain('To: john@example.com');
  });
});
