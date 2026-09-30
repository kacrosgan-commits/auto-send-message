import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validate } from '../middleware/validation.middleware';
import {
  deleteContact,
  deleteContacts,
  getContact,
  getSummary,
  listContactedAddresses,
  listContacts,
  lookupContacts,
  normalizeContactPayload,
  saveContact,
  saveContactsBulk,
  updateContact,
} from '../services/contact.service';
import { maskEmail } from '../utils/email';
import { logger } from '../utils/logger';
import { CONTACT_STATUSES, type ContactStatus } from '../types';

export const contactsRouter = Router();

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
  '/bulk',
  asyncRoute(async (req, res) => {
    const items = req.body?.contacts;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'contacts must be a non-empty array.',
        details: [{ path: 'contacts', message: 'contacts must be a non-empty array.' }],
      });
      return;
    }
    if (items.length > 50) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'A batch can include at most 50 contacts.',
        details: [{ path: 'contacts', message: 'A batch can include at most 50 contacts.' }],
      });
      return;
    }
    logger.info(`[Contacts] POST /api/contacts/bulk count=${items.length}`);
    res.json(await saveContactsBulk(items));
  }),
);

contactsRouter.post(
  '/bulk-delete',
  validate({
    body: z.object({
      contactIds: z.array(z.string().min(1).max(64)).min(1).max(500),
    }),
  }),
  asyncRoute(async (req, res) => {
    const deleted = await deleteContacts(req.body.contactIds);
    res.json({ success: true, deleted });
  }),
);

contactsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    logger.info('[Contacts] POST /api/contacts');
    const input = normalizeContactPayload(req.body);
    logger.info(`[Contacts] Creating ${input.username} ${maskEmail(input.email)}`);
    const result = await saveContact(input);
    res.status(result.created ? 201 : 200).json(result);
  }),
);

contactsRouter.get(
  '/contacted',
  asyncRoute(async (_req, res) => {
    res.json(await listContactedAddresses());
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
