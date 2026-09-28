import type { ContactRecord, ContactStatus, TemplateContext } from '../types';

const ROLE_WORDS = new Set([
  'senior',
  'sr',
  'junior',
  'jr',
  'lead',
  'principal',
  'staff',
  'full',
  'stack',
  'fullstack',
  'full-stack',
  'engineer',
  'engineering',
  'developer',
  'dev',
  'software',
  'ai',
  'ml',
  'data',
  'scientist',
  'architect',
  'designer',
  'manager',
  'consultant',
  'freelancer',
  'student',
  'founder',
  'cofounder',
  'co-founder',
  'ceo',
  'cto',
  'cfo',
  'coo',
  'vp',
  'head',
  'director',
  'intern',
  'backend',
  'frontend',
  'front-end',
  'back-end',
  'web',
  'mobile',
  'ios',
  'android',
  'devops',
  'sre',
  'qa',
  'tester',
  'programmer',
  'coder',
  'ninja',
  'guru',
  'expert',
  'specialist',
  'analyst',
  'researcher',
  'professor',
  'teacher',
  'instructor',
  'mentor',
  'owner',
  'creator',
  'maker',
  'builder',
  'officer',
  'president',
  'partner',
  'associate',
  'contractor',
  'remote',
  'available',
  'hire',
  'hiring',
  'the',
  'and',
  'of',
]);

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'sir', 'dame']);

export function extractFirstName(
  displayName: string | null | undefined,
  fallback = 'there',
): string {
  if (!displayName) return fallback;
  const cleaned = displayName
    .replace(/[|•·,/\\()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;

  const tokens = cleaned
    .split(' ')
    .map((token) => token.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, ''))
    .filter(Boolean);
  const meaningful = tokens.filter((token) => !HONORIFICS.has(token.toLowerCase().replace(/\./g, '')));
  if (!meaningful.length) return fallback;

  const first = meaningful[0];
  if (!first || ROLE_WORDS.has(first.toLowerCase())) return fallback;
  if (!/^[A-Za-z][A-Za-z'-]{1,40}$/.test(first)) return fallback;
  return formatName(first);
}

function formatName(word: string): string {
  if (word === word.toUpperCase() || word === word.toLowerCase()) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function contextFromContact(contact: Pick<
  ContactRecord,
  'displayName' | 'username' | 'email' | 'githubUrl' | 'bio' | 'company' | 'location' | 'searchKeyword'
>): TemplateContext {
  return {
    name: blankToNull(contact.displayName),
    first_name: extractFirstName(contact.displayName),
    username: contact.username,
    email: contact.email,
    github_url: contact.githubUrl,
    bio: blankToNull(contact.bio),
    company: blankToNull(contact.company),
    location: blankToNull(contact.location),
    search_keyword: blankToNull(contact.searchKeyword),
  };
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export interface InterpolationResult {
  text: string;
  missing: string[];
}

const TOKEN_PATTERN =
  /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|\s*default:\s*(?:"([^"]*)"|'([^']*)'))?\s*\}\}/g;

export function interpolate(template: string, context: TemplateContext): InterpolationResult {
  const missing: string[] = [];
  const text = template.replace(TOKEN_PATTERN, (match, key: string, doubleQuoted?: string, singleQuoted?: string) => {
    const value = lookup(context, key);
    if (value == null || value === '') {
      if (doubleQuoted != null || singleQuoted != null) {
        return doubleQuoted ?? singleQuoted ?? '';
      }
      missing.push(key);
      return match;
    }
    return value;
  });

  const leftovers = text.match(/\{\{[\s\S]*?\}\}/g) ?? [];
  for (const leftover of leftovers) {
    if (!missing.includes(leftover)) missing.push(leftover);
  }
  return { text, missing };
}

function lookup(context: TemplateContext, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(context, key)) return null;
  const value = context[key as keyof TemplateContext];
  return value == null ? null : String(value);
}

export function hasUnresolved(text: string): boolean {
  return /\{\{[\s\S]*?\}\}/.test(text);
}

export function blankToNullExport(value: string | null | undefined): string | null {
  return blankToNull(value);
}

export type { ContactStatus };
