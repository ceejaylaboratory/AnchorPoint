import { Request, Response, NextFunction } from 'express';
import { errorHandler, AppError, asyncHandler } from './error.middleware';

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
      json: jsonMock
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
      expect(error.isOperational).toBe(true);
    });

    it('should create an AppError with custom values', () => {
      const error = new AppError('Not found', 404, true);
      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
      expect(error.isOperational).toBe(true);
    });
  });

  describe('errorHandler', () => {
    it('should handle AppError with custom status code', () => {
      const error = new AppError('Resource not found', 404);
      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'Resource not found'
      });
    });

    it('should handle AppError with default 500 status', () => {
      const error = new AppError('Internal error');
      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'Internal error'
      });
    });

    it('should handle ZodError', () => {
      const zodError = {
        name: 'ZodError',
        issues: [
          { path: ['email'], message: 'Invalid email' },
          { path: ['password'], message: 'Required' }
        ]
      };
      errorHandler(zodError as any, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'Validation failed',
        details: [
          { path: ['email'], message: 'Invalid email' },
          { path: ['password'], message: 'Required' }
        ]
      });
    });

    it('should handle JsonWebTokenError', () => {
      const jwtError = { name: 'JsonWebTokenError' };
      errorHandler(jwtError as any, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'Invalid token'
      });
    });

    it('should handle TokenExpiredError', () => {
      const tokenError = { name: 'TokenExpiredError' };
      errorHandler(tokenError as any, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'Token expired'
      });
    });

    it('should handle Prisma unique constraint error', () => {
      const prismaError = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002'
      };
      errorHandler(prismaError as any, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'A unique constraint failed'
      });
    });

    it('should handle Prisma record not found error', () => {
      const prismaError = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2025'
      };
      errorHandler(prismaError as any, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'Record not found'
      });
    });

    it('should handle unknown errors with 500 status', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Unknown error');
      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(consoleSpy).toHaveBeenCalledWith('Unhandled error:', error);
      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'Unknown error'
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
        status: 'error',
        message: 'Internal server error'
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
