import { Request, Response, NextFunction } from 'express';
import {
  errorHandler,
  asyncHandler,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  InternalServerError,
  ServiceUnavailableError,
} from '../error-handler.middleware';
import { ErrorCode, ProblemTypes } from '../../types/errors';

// Mock logger
jest.mock('../../utils/logger', () => ({
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

describe('Error Handler Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    
    mockRequest = {
      originalUrl: '/api/v1/test',
      method: 'GET',
      path: '/test',
    };
    
    mockResponse = {
      status: statusMock,
      setHeader: jest.fn(),
    };
    
    mockNext = jest.fn();
    
    // Reset env
    process.env.NODE_ENV = 'test';
  });

  describe('AppException subclasses', () => {
    it('should handle ValidationError with RFC 7807 format', () => {
      const error = new ValidationError({
        message: 'Validation failed',
        errors: [
          { field: 'email', message: 'Invalid email format', code: 'INVALID_FORMAT' },
          { field: 'amount', message: 'Must be positive', code: 'INVALID_VALUE' },
        ],
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.VALIDATION_ERROR,
          title: ErrorCode.VALIDATION_ERROR,
          status: 400,
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'email' }),
            expect.objectContaining({ field: 'amount' }),
          ]),
        })
      );
    });

    it('should handle NotFoundError with RFC 7807 format', () => {
      const error = new NotFoundError({
        message: 'User not found',
        resource: 'User',
        id: '123',
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.NOT_FOUND,
          title: ErrorCode.NOT_FOUND,
          status: 404,
          instance: '/api/v1/User/123',
        })
      );
    });

    it('should handle ConflictError with RFC 7807 format', () => {
      const error = new ConflictError({
        message: 'Resource already exists',
        detail: 'A user with this email already exists',
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.CONFLICT,
          title: ErrorCode.CONFLICT,
          status: 409,
          detail: 'Resource already exists',
        })
      );
    });

    it('should handle UnauthorizedError with RFC 7807 format', () => {
      const error = new UnauthorizedError({
        message: 'Authentication required',
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.UNAUTHORIZED,
          title: ErrorCode.UNAUTHORIZED,
          status: 401,
        })
      );
    });

    it('should handle ForbiddenError with RFC 7807 format', () => {
      const error = new ForbiddenError({
        message: 'Access denied',
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.FORBIDDEN,
          title: ErrorCode.FORBIDDEN,
          status: 403,
        })
      );
    });

    it('should handle BadRequestError with RFC 7807 format', () => {
      const error = new BadRequestError({
        message: 'Invalid request',
        code: ErrorCode.INVALID_PARAMETER,
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.BAD_REQUEST,
          title: ErrorCode.BAD_REQUEST,
          status: 400,
        })
      );
    });

    it('should handle InternalServerError with RFC 7807 format', () => {
      const error = new InternalServerError({
        message: 'Something went wrong',
        isOperational: false,
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.INTERNAL_SERVER_ERROR,
          title: ErrorCode.INTERNAL_SERVER_ERROR,
          status: 500,
        })
      );
    });

    it('should handle ServiceUnavailableError with RFC 7807 format', () => {
      const error = new ServiceUnavailableError({
        message: 'Service temporarily unavailable',
        detail: 'Database connection pool exhausted',
      });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.SERVICE_UNAVAILABLE,
          title: ErrorCode.SERVICE_UNAVAILABLE,
          status: 503,
        })
      );
    });
  });

  describe('Standard error types', () => {
    it('should handle ZodError with RFC 7807 format', () => {
      const zodError = new Error('Validation failed');
      zodError.name = 'ZodError';
      (zodError as any).issues = [
        { path: ['email'], message: 'Invalid email', code: 'invalid_string' },
        { path: ['amount'], message: 'Must be positive', code: 'too_small' },
      ];

      errorHandler(zodError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.VALIDATION_ERROR,
          title: ErrorCode.VALIDATION_ERROR,
          status: 400,
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'email' }),
          ]),
        })
      );
    });

    it('should handle JsonWebTokenError with RFC 7807 format', () => {
      const jwtError = new Error('Invalid token');
      jwtError.name = 'JsonWebTokenError';

      errorHandler(jwtError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.UNAUTHORIZED,
          title: ErrorCode.INVALID_TOKEN,
          status: 401,
        })
      );
    });

    it('should handle TokenExpiredError with RFC 7807 format', () => {
      const expiredError = new Error('Token expired');
      expiredError.name = 'TokenExpiredError';

      errorHandler(expiredError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.UNAUTHORIZED,
          title: ErrorCode.TOKEN_EXPIRED,
          status: 401,
        })
      );
    });

    it('should handle Prisma P2002 (unique constraint) as ConflictError', () => {
      const prismaError = new Error('Unique constraint failed');
      prismaError.name = 'PrismaClientKnownRequestError';
      (prismaError as any).code = 'P2002';
      (prismaError as any).meta = { target: ['email'] };

      errorHandler(prismaError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.CONFLICT,
          title: ErrorCode.ALREADY_EXISTS,
          status: 409,
        })
      );
    });

    it('should handle Prisma P2025 (record not found) as NotFoundError', () => {
      const prismaError = new Error('Record not found');
      prismaError.name = 'PrismaClientKnownRequestError';
      (prismaError as any).code = 'P2025';

      errorHandler(prismaError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ProblemTypes.NOT_FOUND,
          title: ErrorCode.NOT_FOUND,
          status: 404,
        })
      );
    });
  });

  describe('Content-Type header', () => {
    it('should set application/problem+json content type', () => {
      const error = new NotFoundError({ message: 'Not found' });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/problem+json');
    });
  });

  describe('asyncHandler', () => {
    it('should wrap async handlers and catch errors', async () => {
      const mockReq = {} as Request;
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      const mockNext = jest.fn();

      const handler = asyncHandler(async () => {
        throw new NotFoundError({ message: 'Not found' });
      });

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(NotFoundError));
    });

    it('should pass result to next middleware on success', async () => {
      const mockReq = {} as Request;
      const mockRes = {} as Response;
      const mockNext = jest.fn();

      const handler = asyncHandler(async () => {
        return { success: true };
      });

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });
});

describe('RFC 7807 Problem Details format', () => {
  it('should contain all required fields', () => {
    const error = new ValidationError({
      message: 'Validation failed',
      errors: [{ field: 'name', message: 'Required' }],
    });

    const problem = error.toProblem();

    expect(problem).toHaveProperty('type');
    expect(problem).toHaveProperty('title');
    expect(problem).toHaveProperty('status');
    expect(problem).toHaveProperty('detail');
    expect(problem).toHaveProperty('instance');
    expect(problem).toHaveProperty('code');
    expect(problem).toHaveProperty('errors');
  });

  it('should have correct type URIs', () => {
    expect(ProblemTypes.BAD_REQUEST).toContain('bad-request');
    expect(ProblemTypes.UNAUTHORIZED).toContain('unauthorized');
    expect(ProblemTypes.FORBIDDEN).toContain('forbidden');
    expect(ProblemTypes.NOT_FOUND).toContain('not-found');
    expect(ProblemTypes.CONFLICT).toContain('conflict');
    expect(ProblemTypes.VALIDATION_ERROR).toContain('validation-error');
    expect(ProblemTypes.RATE_LIMIT_EXCEEDED).toContain('rate-limit');
    expect(ProblemTypes.INTERNAL_SERVER_ERROR).toContain('internal-server-error');
  });

  it('should use urn:anchorpoint prefix', () => {
    Object.values(ProblemTypes).forEach((type) => {
      expect(type).toMatch(/^urn:anchorpoint:/);
    });
  });
});