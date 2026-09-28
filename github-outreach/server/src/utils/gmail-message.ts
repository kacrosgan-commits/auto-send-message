export interface MimeInput {
  to: string;
  subject: string;
  body: string;
  from?: string;
}

export function buildPlainTextMime(input: MimeInput): string {
  const to = safeHeader(input.to);
  const subject = encodeSubject(safeHeader(input.subject));
  const body = input.body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  const headers = [
    `To: ${to}`,
    ...(input.from ? [`From: ${safeHeader(input.from)}`] : []),
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

export function encodeMimeBase64Url(mime: string): string {
  return Buffer.from(mime, 'utf8').toString('base64url');
}

export function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function encodeSubject(value: string): string {
  if (/^[\u0020-\u007E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function buildEncodedMime(input: MimeInput): string {
  return encodeMimeBase64Url(buildPlainTextMime(input));
}
