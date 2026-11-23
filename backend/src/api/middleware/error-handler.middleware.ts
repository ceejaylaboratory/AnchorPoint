import { Request, Response, NextFunction } from 'express';
import {
  AppException,
  ApiProblem,
  ProblemTypes,
  ErrorCode,
  ValidationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ForbiddenError,
  UnauthorizedError,
  InternalServerError,
  ServiceUnavailableError,
} from '../../types/errors';
import logger from '../../utils/logger';

/**
 * Global error handling middleware
 * Maps standard application errors to RFC 7807 Problem Details format
 */
export const errorHandler = (
  err: Error | AppException,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  void next;

  // Handle typed AppException instances
  if (err instanceof AppException) {
    const problem: ApiProblem = err.toProblem();
    problem.instance = err.instance || req.originalUrl;

    res.setHeader('Content-Type', 'application/problem+json');
    res.status(err.statusCode).json(problem);
    return;
  }

  // Handle Zod validation errors
  if (err.name === 'ZodError') {
    const zodError = err as Error & {
      issues?: Array<{
        path: Array<string | number>;
        message: string;
        code?: string;
      }>;
    };

    const fieldErrors: Array<{ field: string; message: string; code: string }> = [];
    const issues = zodError.issues?.map((issue) => {
      const field = issue.path.join('.');
      fieldErrors.push({
        field,
        message: issue.message,
        code: issue.code || 'invalid',
      });
      return {
        path: issue.path,
        message: issue.message,
      };
    }) || [];

    const problem: ApiProblem = {
      type: ProblemTypes.VALIDATION_ERROR,
      title: ErrorCode.VALIDATION_ERROR,
      status: 400,
      detail: 'Validation failed for one or more fields',
      instance: req.originalUrl,
      code: ErrorCode.VALIDATION_ERROR,
      errors: fieldErrors,
    };

    res.setHeader('Content-Type', 'application/problem+json');
    res.status(400).json(problem);
    return;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    const problem: ApiProblem = {
      type: ProblemTypes.UNAUTHORIZED,
      title: ErrorCode.INVALID_TOKEN,
      status: 401,
      detail: 'The provided token is invalid',
      instance: req.originalUrl,
      code: ErrorCode.INVALID_TOKEN,
    };

    res.setHeader('Content-Type', 'application/problem+json');
    res.status(401).json(problem);
    return;
  }

  if (err.name === 'TokenExpiredError') {
    const problem: ApiProblem = {
      type: ProblemTypes.UNAUTHORIZED,
      title: ErrorCode.TOKEN_EXPIRED,
      status: 401,
      detail: 'The provided token has expired',
      instance: req.originalUrl,
      code: ErrorCode.TOKEN_EXPIRED,
    };

    res.setHeader('Content-Type', 'application/problem+json');
    res.status(401).json(problem);
    return;
  }

  // Handle Prisma known request errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as Error & { code?: string; meta?: Record<string, unknown> };

    if (prismaError.code === 'P2002') {
      const problem: ApiProblem = {
        type: ProblemTypes.CONFLICT,
        title: ErrorCode.ALREADY_EXISTS,
        status: 409,
        detail: 'A record with the specified unique fields already exists',
        instance: req.originalUrl,
        code: ErrorCode.ALREADY_EXISTS,
        errors: prismaError.meta
          ? [
              {
                message: 'Unique constraint violation',
                code: 'UNIQUE_CONSTRAINT',
              },
            ]
          : undefined,
      };

      res.setHeader('Content-Type', 'application/problem+json');
      res.status(409).json(problem);
      return;
    }

    if (prismaError.code === 'P2025') {
      const problem: ApiProblem = {
        type: ProblemTypes.NOT_FOUND,
        title: ErrorCode.NOT_FOUND,
        status: 404,
        detail: 'The requested record was not found',
        instance: req.originalUrl,
        code: ErrorCode.NOT_FOUND,
      };

      res.setHeader('Content-Type', 'application/problem+json');
      res.status(404).json(problem);
      return;
    }
  }

  // Handle Prisma unknown errors
  if (err.name === 'PrismaClientUnknownRequestError') {
    logger.error('Prisma unknown error', { error: err.message, stack: err.stack });

    const problem: ApiProblem = {
      type: ProblemTypes.INTERNAL_SERVER_ERROR,
      title: ErrorCode.INTERNAL_SERVER_ERROR,
      status: 500,
      detail:
        process.env.NODE_ENV === 'production'
          ? 'An internal error occurred'
          : 'Database operation failed',
      instance: req.originalUrl,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
    };

    res.setHeader('Content-Type', 'application/problem+json');
    res.status(500).json(problem);
    return;
  }

  // Handle Stripe errors (external service)
  if (err.name === 'StripeError' || (err as Error & { type?: string }).type?.startsWith('Stripe')) {
    const stripeError = err as Error & { type?: string; message?: string };

    const statusCode =
      stripeError.type === 'card_error' ? 400 : stripeError.type === 'invalid_request_error' ? 400 : 502;

    const problem: ApiProblem = {
      type: ProblemTypes.SERVICE_UNAVAILABLE,
      title: ErrorCode.EXTERNAL_SERVICE_ERROR,
      status: statusCode,
      detail: 'Payment service temporarily unavailable',
      instance: req.originalUrl,
      code: ErrorCode.EXTERNAL_SERVICE_ERROR,
    };

    res.setHeader('Content-Type', 'application/problem+json');
    res.status(statusCode).json(problem);
    return;
  }

  // Default: handle unknown errors
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const problem: ApiProblem = {
    type: ProblemTypes.INTERNAL_SERVER_ERROR,
    title: ErrorCode.INTERNAL_SERVER_ERROR,
    status: 500,
    detail:
      process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message,
    instance: req.originalUrl,
    code: ErrorCode.INTERNAL_SERVER_ERROR,
  };

  res.setHeader('Content-Type', 'application/problem+json');
  res.status(500).json(problem);
};

/**
 * Async handler wrapper to catch async errors and forward them to the error handler
 * @param fn - An async Express route handler
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Not found handler for unmatched routes
 */
export const notFoundHandler = (req: Request, res: Response, _next: NextFunction): void => {
  const problem: ApiProblem = {
    type: ProblemTypes.NOT_FOUND,
    title: ErrorCode.NOT_FOUND,
    status: 404,
    detail: `Cannot ${req.method} ${req.path}`,
    instance: req.originalUrl,
    code: ErrorCode.NOT_FOUND,
  };

  res.setHeader('Content-Type', 'application/problem+json');
  res.status(404).json(problem);
};

// Export error types for convenience
export {
  AppException,
  ValidationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ForbiddenError,
  UnauthorizedError,
  InternalServerError,
  ServiceUnavailableError,
};