import { type ZodSchema, ZodError } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { BadRequestError } from '../utils/error';

interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

/**
 * Express middleware that validates request body, params, and/or query against Zod schemas.
 *
 * On success the parsed (and potentially transformed) values replace the raw
 * values on `req`, so downstream handlers receive clean, typed data.
 *
 * On failure a BadRequestError is thrown with structured Zod issue details,
 * which the global errorHandler middleware serialises into a 400 JSON response.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        // Express 5 defines `req.query` as a getter with no setter, so a plain
        // assignment throws at runtime. Redefining the property keeps the
        // parsed value visible to every downstream `req.query` read, which is
        // exactly what handlers expect, without touching the raw query parser.
        Object.defineProperty(req, 'query', {
          value: schemas.query.parse(req.query),
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details: Record<string, unknown> = {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
        };
        throw new BadRequestError('Validation failed', details);
      }
      throw error;
    }
  };
}
