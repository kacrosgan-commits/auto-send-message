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

  if (err instanceof AppError && err.code === 'VALIDATION') {
    if (req.path.startsWith('/api/contacts')) {
      logger.warn({ details: err.details }, '[Contacts] Validation failed');
    }
    res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: err.message,
      details: err.details ?? [],
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError || err instanceof Prisma.PrismaClientInitializationError) {
    logger.error({ message: err.message }, '[Contacts] Database error');
    const duplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
    res.status(duplicate ? 409 : 500).json({
      success: false,
      error: duplicate ? 'DUPLICATE' : 'DATABASE_ERROR',
      message: duplicate ? 'Already in outreach' : 'The contact could not be saved.',
    });
    return;
  }

  const status = err instanceof AppError ? err.status : 500;
  const message = err instanceof AppError ? err.message : 'Something went wrong.';
  const code = err instanceof AppError ? err.code ?? 'INTERNAL' : 'INTERNAL';

  if (!(err instanceof AppError) || status >= 500) {
    logger.error(
      { path: req.path, message: err instanceof Error ? err.message : 'unknown error' },
      status >= 500 && req.path.startsWith('/api/contacts') ? '[Contacts] Database error' : 'Request failed',
    );
  }

  res.status(status).json({
    success: false,
    error: code,
    message,
  });
}
