import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validate } from '../middleware/validation.middleware';
import { authStatus, createAuthUrl, handleCallback, logout } from '../services/google-auth.service';
import { AppError } from '../utils/errors';

export const authRouter = Router();

authRouter.get(
  '/google',
  asyncRoute(async (_req, res) => {
    res.redirect(createAuthUrl());
  }),
);

authRouter.get(
  '/google/callback',
  asyncRoute(async (req, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : undefined;
      const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined;
      await handleCallback(code, state, oauthError);
      res.redirect('/?gmail=connected');
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Google connection failed.';
      res.redirect(`/?gmail=error&message=${encodeURIComponent(message)}`);
    }
  }),
);

authRouter.get(
  '/status',
  asyncRoute(async (_req, res) => {
    res.json(await authStatus());
  }),
);

authRouter.post(
  '/logout',
  validate({ body: z.object({}).optional() }),
  asyncRoute(async (_req, res) => {
    await logout();
    res.json({ ok: true });
  }),
);
