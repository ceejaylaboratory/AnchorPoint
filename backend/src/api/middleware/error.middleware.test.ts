import { Request, Response, NextFunction } from 'express';
import { errorHandler, AppError, asyncHandler, getDefaultErrorCode } from './error.middleware';

describe('Error Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockReq = {};
    mockRes = {
      status: statusMock,
      json: jsonMock,
    } as any;
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('AppError', () => {
    it('should create an AppError with default values', () => {
      const error = new AppError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(error.isOperational).toBe(true);
    });

    it('should create an AppError with custom values', () => {
      const error = new AppError('Not found', 404, 'NOT_FOUND', { resource: 'User' }, true);
      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toEqual({ resource: 'User' });
      expect(error.isOperational).toBe(true);
    });
  });

  describe('getDefaultErrorCode', () => {
    it('maps standard status codes to RFC 7807 string codes', () => {
      expect(getDefaultErrorCode(400)).toBe('BAD_REQUEST');
      expect(getDefaultErrorCode(401)).toBe('UNAUTHORIZED');
      expect(getDefaultErrorCode(403)).toBe('FORBIDDEN');
      expect(getDefaultErrorCode(404)).toBe('NOT_FOUND');
      expect(getDefaultErrorCode(409)).toBe('CONFLICT');
      expect(getDefaultErrorCode(422)).toBe('UNPROCESSABLE_ENTITY');
      expect(getDefaultErrorCode(429)).toBe('RATE_LIMIT_EXCEEDED');
      expect(getDefaultErrorCode(502)).toBe('BAD_GATEWAY');
      expect(getDefaultErrorCode(503)).toBe('SERVICE_UNAVAILABLE');
      expect(getDefaultErrorCode(500)).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('errorHandler', () => {
    it('should handle AppError with custom status code and structured format', () => {
      const error = new AppError('Resource not found', 404);
      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      });
    });

    it('should handle AppError with custom code and details', () => {
      const error = new AppError('Invalid parameter', 400, 'PARAM_INVALID', { field: 'email' });
      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 'PARAM_INVALID',
          message: 'Invalid parameter',
          details: { field: 'email' },
        },
      });
    });

    it('should handle AppError with default 500 status', () => {
      const error = new AppError('Internal error');
      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal error',
        },
      });
    });

    it('should handle ZodError with per-field details', () => {
      const zodError = {
        name: 'ZodError',
        issues: [
          { path: ['email'], message: 'Invalid email' },
          { path: ['password'], message: 'Required' },
        ],
      };
      errorHandler(zodError as any, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: {
            fields: {
              email: 'Invalid email',
              password: 'Required',
            },
            issues: [
              { path: ['email'], message: 'Invalid email' },
              { path: ['password'], message: 'Required' },
            ],
          },
        },
      });
    });

    it('should handle JsonWebTokenError', () => {
      const jwtError = { name: 'JsonWebTokenError' };
      errorHandler(jwtError as any, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid token',
        },
      });
    });

    it('should handle TokenExpiredError', () => {
      const tokenError = { name: 'TokenExpiredError' };
      errorHandler(tokenError as any, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Token expired',
        },
      });
    });

    it('should handle Prisma unique constraint error', () => {
      const prismaError = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        meta: { target: ['email'] },
      };
      errorHandler(prismaError as any, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 'CONFLICT',
          message: 'A unique constraint failed',
          details: { target: ['email'] },
        },
      });
    });

    it('should handle Prisma record not found error', () => {
      const prismaError = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
      };
      errorHandler(prismaError as any, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 'NOT_FOUND',
          message: 'Record not found',
        },
      });
    });

    it('should handle unknown errors with 500 status', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Unknown error');
      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(consoleSpy).toHaveBeenCalledWith('Unhandled error:', error);
      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unknown error',
        },
      });

      consoleSpy.mockRestore();
    });

    it('should hide error message in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Sensitive error');
      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error',
        },
      });

      consoleSpy.mockRestore();
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('asyncHandler', () => {
    it('should call next with error when async function throws', async () => {
      const error = new Error('Async error');
      const asyncFn = jest.fn().mockRejectedValue(error);
      const handler = asyncHandler(asyncFn);

      await handler(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should not call next when async function succeeds', async () => {
      const asyncFn = jest.fn().mockResolvedValue(undefined);
      const handler = asyncHandler(asyncFn);

      await handler(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
