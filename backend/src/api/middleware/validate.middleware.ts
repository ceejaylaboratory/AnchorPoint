import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Middleware for validating Express request segments (body, query, params)
 * Standardized to produce RFC 7807-compatible error response format with per-field details.
 * @param schema - An object containing Zod schemas for body, query, and params
 */
export const validate = (schema: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema.body) {
        req.body = await schema.body.parseAsync(req.body);
      }
      if (schema.query) {
        req.query = await schema.query.parseAsync(req.query) as any;
      }
      if (schema.params) {
        req.params = await schema.params.parseAsync(req.params) as any;
      }
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const fields: Record<string, string> = {};
        for (const issue of error.issues) {
          const fieldPath = issue.path.join('.');
          if (fieldPath) {
            fields[fieldPath] = issue.message;
          }
        }
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: {
              fields,
              issues: error.issues.map(issue => ({
                path: issue.path,
                message: issue.message,
              })),
            },
          },
        });
      }
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error during validation',
        },
      });
    }
  };
};
