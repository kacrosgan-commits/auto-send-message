import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { AppError } from '../utils/errors';

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function validate(schemas: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query) as Request['query'];
      if (schemas.params) req.params = schemas.params.parse(req.params) as Request['params'];
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues
          .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
          .join('; ');
        next(new AppError(400, message, 'VALIDATION'));
        return;
      }
      next(error);
    }
  };
}
