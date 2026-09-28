import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: 'Already in outreach', code: 'DUPLICATE' });
    return;
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    logger.error({ message: err.message }, 'Database error');
    res.status(500).json({ error: 'Database error. Check that the SQLite file is available.', code: 'DATABASE' });
    return;
  }

  const status = err instanceof AppError ? err.status : 500;
  const message = err instanceof AppError ? err.message : 'Something went wrong.';
  const code = err instanceof AppError ? err.code ?? null : 'INTERNAL';

  if (!(err instanceof AppError) || status >= 500) {
    logger.error(
      { path: req.path, message: err instanceof Error ? err.message : 'unknown error' },
      'Request failed',
    );
  }

  res.status(status).json({ error: message, code });
}
