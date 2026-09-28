const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const NOREPLY_SUFFIXES = ['@users.noreply.github.com', '@noreply.github.com'];

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateEmail(
  raw: string,
): { ok: true; email: string } | { ok: false; reason: string } {
  const email = normalizeEmail(raw);
  if (!email || email.length > 320 || !EMAIL_PATTERN.test(email)) {
    return { ok: false, reason: 'Invalid email address.' };
  }
  if (NOREPLY_SUFFIXES.some((suffix) => email.endsWith(suffix))) {
    return {
      ok: false,
      reason: 'GitHub noreply addresses are not public contact emails.',
    };
  }
  return { ok: true, email };
}

export function maskEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.indexOf('@');
  if (at <= 0) return '***';
  return `${normalized.slice(0, 1)}***@${normalized.slice(at + 1)}`;
}

export function emailsMatch(left: string, right: string): boolean {
  return normalizeEmail(left) === normalizeEmail(right);
}
