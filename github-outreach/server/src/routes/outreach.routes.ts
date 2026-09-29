import { Router } from 'express';
import type { OutreachStatus } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute, validate } from '../middleware/validation.middleware';
import {
  approveOutreach,
  approveOutreachBulk,
  createDraftForContact,
  createDraftsBulk,
  listOutreach,
  sendOutreach,
  sendOutreachBulk,
  sendPlacementTest,
} from '../services/outreach.service';
import { OUTREACH_STATUSES } from '../types';

export const outreachRouter = Router();

outreachRouter.get(
  '/',
  validate({
    query: z.object({
      status: z.enum(OUTREACH_STATUSES).optional(),
    }),
  }),
  asyncRoute(async (req, res) => {
    const status = typeof req.query.status === 'string' ? (req.query.status as OutreachStatus) : undefined;
    res.json({ outreach: await listOutreach(status) });
  }),
);

outreachRouter.post(
  '/bulk-draft',
  validate({
    body: z.object({
      contactIds: z.array(z.string().min(1).max(64)).min(1).max(50),
      templateId: z.string().min(1).max(64),
    }),
  }),
  asyncRoute(async (req, res) => {
    res.json(await createDraftsBulk(req.body.contactIds, req.body.templateId));
  }),
);

outreachRouter.post(
  '/bulk-approve',
  validate({
    body: z.object({
      outreachIds: z.array(z.string().min(1).max(64)).min(1).max(50),
    }),
  }),
  asyncRoute(async (req, res) => {
    res.json(await approveOutreachBulk(req.body.outreachIds));
  }),
);

outreachRouter.post(
  '/bulk-send',
  validate({
    body: z.object({
      outreachIds: z.array(z.string().min(1).max(64)).min(1).max(50),
    }),
  }),
  asyncRoute(async (req, res) => {
    res.json(await sendOutreachBulk(req.body.outreachIds));
  }),
);

outreachRouter.post(
  '/placement-test',
  validate({
    body: z.object({
      templateId: z.string().min(1).max(64).optional(),
      subject: z.string().trim().min(1).max(200).optional(),
      body: z.string().trim().min(1).max(20000).optional(),
    }).refine((value) => Boolean(value.templateId || (value.subject && value.body)), {
      message: 'Choose a template or a message to test.',
    }),
  }),
  asyncRoute(async (req, res) => {
    res.json(await sendPlacementTest(req.body));
  }),
);

outreachRouter.post(
  '/:contactId/draft',
  validate({
    params: z.object({ contactId: z.string().min(1).max(64) }),
    body: z.object({
      templateId: z.string().min(1).max(64).nullable().optional(),
      subject: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(20000),
    }),
  }),
  asyncRoute(async (req, res) => {
    const outreach = await createDraftForContact(paramId(req.params.contactId), req.body);
    res.status(201).json({ outreach });
  }),
);

outreachRouter.post(
  '/:outreachId/approve',
  validate({
    params: z.object({ outreachId: z.string().min(1).max(64) }),
    body: z.object({}).optional(),
  }),
  asyncRoute(async (req, res) => {
    const outreach = await approveOutreach(paramId(req.params.outreachId));
    res.json({ outreach });
  }),
);

outreachRouter.post(
  '/:outreachId/send',
  validate({
    params: z.object({ outreachId: z.string().min(1).max(64) }),
    body: z.object({}).optional(),
  }),
  asyncRoute(async (req, res) => {
    const outreach = await sendOutreach(paramId(req.params.outreachId));
    res.json({ outreach });
  }),
);

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value;
}
