import { Request, Response, NextFunction } from 'express';

/**
 * Standard RFC 7807-compatible error payload structure
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown> | Array<unknown>;
  };
}

/**
 * Map standard HTTP status codes to machine-readable string error codes
 */
export function getDefaultErrorCode(statusCode: number): string {
  switch (statusCode) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 422: return 'UNPROCESSABLE_ENTITY';
    case 429: return 'RATE_LIMIT_EXCEEDED';
    case 502: return 'BAD_GATEWAY';
    case 503: return 'SERVICE_UNAVAILABLE';
    default: return 'INTERNAL_SERVER_ERROR';
  }
}

/**
 * Custom error class for application-level errors
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown> | Array<unknown>;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code?: string,
    details?: Record<string, unknown> | Array<unknown>,
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || getDefaultErrorCode(statusCode);
    this.details = details;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Global error handling middleware
 * Catches all async errors and standardizes API error responses
 */
export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  void next;

  // Handle AppError instances
  if (err instanceof AppError) {
    const errorBody: { code: string; message: string; details?: Record<string, unknown> | Array<unknown> } = {
      code: err.code,
      message: err.message,
    };
    if (err.details !== undefined) {
      errorBody.details = err.details;
    }
    return res.status(err.statusCode).json({
      error: errorBody,
    });
  }

  // Handle Zod validation errors (already handled in validate middleware, but as fallback)
  if (err.name === 'ZodError') {
    const zodError = err as Error & {
      issues?: Array<{
        path: Array<string | number>;
        message: string;
      }>;
    };

    const fieldDetails: Record<string, string> = {};
    const issues = zodError.issues?.map((issue) => {
      const field = issue.path.join('.');
      if (field) {
        fieldDetails[field] = issue.message;
      }
      return {
        path: issue.path,
        message: issue.message,
      };
    }) || [];

    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: {
          fields: fieldDetails,
          issues,
        },
      },
    });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid token',
      },
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Token expired',
      },
    });
  }

  // Handle Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as Error & { code?: string; meta?: Record<string, unknown> };
    if (prismaError.code === 'P2002') {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'A unique constraint failed',
          ...(prismaError.meta ? { details: prismaError.meta } : {}),
        },
      });
    }
    if (prismaError.code === 'P2025') {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Record not found',
        },
      });
    }
  }

  // Default: handle unknown errors
  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message,
    },
  });
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
