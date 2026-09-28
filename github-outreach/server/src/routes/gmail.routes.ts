import { Router } from 'express';
import { asyncRoute } from '../middleware/validation.middleware';
import { authStatus } from '../services/google-auth.service';
import { listOutreach } from '../services/outreach.service';

export const gmailRouter = Router();

gmailRouter.get(
  '/status',
  asyncRoute(async (_req, res) => {
    res.json(await authStatus());
  }),
);

gmailRouter.get(
  '/drafts',
  asyncRoute(async (_req, res) => {
    const outreach = await listOutreach();
    const drafts = outreach.filter((item) => item.gmailDraftId && item.status !== 'SENT');
    res.json({ drafts });
  }),
);
