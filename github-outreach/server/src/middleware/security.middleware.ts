import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';

const allowedOrigins = [
  'https://github.com',
  'http://localhost:3847',
  'http://127.0.0.1:3847',
];

const corsMiddleware = cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept'],
  optionsSuccessStatus: 204,
});

function githubUserscriptAllowed(method: string, path: string): boolean {
  if (method === 'GET' && (path === '/api/health' || path === '/api/stats' || path === '/api/contacts' || path === '/api/contacts/lookup')) {
    return true;
  }
  return method === 'POST' && path === '/api/contacts';
}

export function securityMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.hostname !== 'localhost' && req.hostname !== '127.0.0.1') {
    res.status(403).json({ error: 'This server only accepts localhost requests.', code: 'HOST' });
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' https://avatars.githubusercontent.com data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader('Cache-Control', 'no-store');
  // Chrome blocks public sites such as github.com from calling localhost
  // unless the preflight explicitly allows private-network access.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  const origin = req.header('origin');
  if (origin && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: 'Origin not allowed.', code: 'ORIGIN' });
    return;
  }

  if (origin === 'https://github.com' && req.method !== 'OPTIONS' && !githubUserscriptAllowed(req.method, req.path)) {
    res.status(403).json({ error: 'This action is only available from the local dashboard.', code: 'ORIGIN' });
    return;
  }

  corsMiddleware(req, res, next);
}
