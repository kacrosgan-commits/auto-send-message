import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validate } from '../middleware/validation.middleware';
import {
  deleteContact,
  getContact,
  getSummary,
  listContacts,
  lookupContacts,
  saveContact,
  updateContact,
} from '../services/contact.service';
import { CONTACT_STATUSES, type ContactStatus } from '../types';

export const contactsRouter = Router();

const contactBody = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, 'Enter a valid GitHub username.'),
  displayName: z.string().trim().max(200).optional().nullable(),
  email: z.string().trim().min(3).max(320),
  githubUrl: z
    .string()
    .trim()
    .url()
    .refine((value) => /^https:\/\/github\.com\/[A-Za-z0-9-]+\/?$/.test(value), 'GitHub profile URL is required.'),
  avatarUrl: z.union([z.string().trim().url().max(2000), z.literal(''), z.null()]).optional(),
  bio: z.string().trim().max(4000).optional().nullable(),
  location: z.string().trim().max(200).optional().nullable(),
  company: z.string().trim().max(200).optional().nullable(),
  searchKeyword: z.string().trim().max(200).optional().nullable(),
  source: z.literal('github').optional(),
});

const listQuery = z.object({
  status: z.enum(CONTACT_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
  searchKeyword: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  username: z.string().trim().max(100).optional(),
  hasEmail: z.enum(['true', 'false']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

contactsRouter.get(
  '/summary',
  asyncRoute(async (_req, res) => {
    res.json(await getSummary());
  }),
);

contactsRouter.get(
  '/lookup',
  validate({
    query: z.object({
      emails: z.string().max(8000).optional(),
      usernames: z.string().max(4000).optional(),
    }),
  }),
  asyncRoute(async (req, res) => {
    const emails = String(req.query.emails ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const usernames = String(req.query.usernames ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const contacts = await lookupContacts(emails, usernames);
    res.json({ contacts });
  }),
);

contactsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncRoute(async (req, res) => {
    const contacts = await listContacts({
      status: req.query.status as ContactStatus | undefined,
      q: optionalString(req.query.q),
      searchKeyword: optionalString(req.query.searchKeyword),
      company: optionalString(req.query.company),
      location: optionalString(req.query.location),
      username: optionalString(req.query.username),
      hasEmail: req.query.hasEmail === 'true' || req.query.hasEmail === 'false' ? req.query.hasEmail : undefined,
      from: optionalString(req.query.from),
      to: optionalString(req.query.to),
    });
    res.json({ contacts });
  }),
);

contactsRouter.post(
  '/',
  validate({ body: contactBody }),
  asyncRoute(async (req, res) => {
    const result = await saveContact(req.body);
    res.status(result.created ? 201 : 200).json(result);
  }),
);

contactsRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1).max(64) }) }),
  asyncRoute(async (req, res) => {
    res.json({ contact: await getContact(paramId(req.params.id)) });
  }),
);

contactsRouter.patch(
  '/:id',
  validate({
    params: z.object({ id: z.string().min(1).max(64) }),
    body: z.object({ status: z.enum(['DO_NOT_CONTACT', 'OPTED_OUT', 'REPLIED']) }),
  }),
  asyncRoute(async (req, res) => {
    const contact = await updateContact(paramId(req.params.id), req.body.status);
    res.json({ contact });
  }),
);

contactsRouter.delete(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1).max(64) }) }),
  asyncRoute(async (req, res) => {
    await deleteContact(paramId(req.params.id));
    res.json({ ok: true });
  }),
);

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value;
}
