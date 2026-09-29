import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validate } from '../middleware/validation.middleware';
import { getSendSettings, updateSendSettings } from '../services/settings.service';

export const settingsRouter = Router();

settingsRouter.get(
  '/',
  asyncRoute(async (_req, res) => {
    res.json(await getSendSettings());
  }),
);

settingsRouter.patch(
  '/',
  validate({
    body: z.object({
      maxSendsPerDay: z.number().int().min(1).max(500).optional(),
      minSecondsBetweenSends: z.number().int().min(0).max(3600).optional(),
      testRecipient: z.string().trim().max(320).optional(),
    }),
  }),
  asyncRoute(async (req, res) => {
    res.json(await updateSendSettings(req.body));
  }),
);
