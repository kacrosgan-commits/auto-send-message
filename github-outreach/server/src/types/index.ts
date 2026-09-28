export const CONTACT_STATUSES = [
  'NEW',
  'DRAFTED',
  'APPROVED',
  'SENT',
  'REPLIED',
  'FAILED',
  'OPTED_OUT',
  'DO_NOT_CONTACT',
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const OUTREACH_STATUSES = ['DRAFTED', 'APPROVED', 'SENT', 'FAILED'] as const;

export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const TEMPLATE_VARIABLES = [
  'name',
  'first_name',
  'username',
  'email',
  'github_url',
  'bio',
  'company',
  'location',
  'search_keyword',
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export interface ContactRecord {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  githubUrl: string;
  avatarUrl: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  searchKeyword: string | null;
  source: string;
  status: ContactStatus;
  createdAt: Date;
  updatedAt: Date;
  lastContactedAt: Date | null;
  contactAttempts: number;
}

export interface TemplateContext {
  name: string | null;
  first_name: string;
  username: string;
  email: string;
  github_url: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  search_keyword: string | null;
}
