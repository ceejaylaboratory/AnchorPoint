import { Request, Response, NextFunction } from 'express';

/**
 * Custom error class for application-level errors
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
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
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Handle AppError instances
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message
    });
  }

  // Handle Zod validation errors (already handled in validate middleware, but as fallback)
  if (err.name === 'ZodError') {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      details: (err as any).issues?.map((issue: any) => ({
        path: issue.path,
        message: issue.message
      }))
    });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      status: 'error',
      message: 'Token expired'
    });
  }

  // Handle Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any;
    if (prismaError.code === 'P2002') {
      return res.status(409).json({
        status: 'error',
        message: 'A unique constraint failed'
      });
    }
    if (prismaError.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Record not found'
      });
    }
  }

  // Default: handle unknown errors
  console.error('Unhandled error:', err);
  return res.status(500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
};

/**
 * Async handler wrapper to catch async errors and forward them to the error handler
 * @param fn - An async Express route handler
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
