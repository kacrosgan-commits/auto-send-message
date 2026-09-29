import path from 'path';
import express from 'express';
import { authRouter } from './routes/auth.routes';
import { contactsRouter } from './routes/contacts.routes';
import { gmailRouter } from './routes/gmail.routes';
import { outreachRouter } from './routes/outreach.routes';
import { templatesRouter } from './routes/templates.routes';
import { settingsRouter } from './routes/settings.routes';
import { errorMiddleware } from './middleware/error.middleware';
import { securityMiddleware } from './middleware/security.middleware';
import { config } from './config';
import { getSummary } from './services/contact.service';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));
  app.use(securityMiddleware);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, status: 'online', testMode: config.outreachTestMode });
  });
  app.get('/api/stats', async (_req, res, next) => {
    try {
      res.json(await getSummary());
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/outreach', outreachRouter);
  app.use('/api/gmail', gmailRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  });

  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(errorMiddleware);
  return app;
}
