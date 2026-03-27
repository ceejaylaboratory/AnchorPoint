import { Request, Response } from 'express';
import { RedisService } from '../../services/redis.service';
import { getChallenge, getToken } from './auth.controller';
import * as authService from '../../services/auth.service';

jest.mock('../../services/auth.service');

describe('Auth Controller', () => {
  let mockRedisService: Partial<RedisService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockRedisService = {
      getJSON: jest.fn(),
      setJSON: jest.fn(),
      del: jest.fn()
    };

    mockRequest = {
      body: {}
    };

    mockResponse = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis()
    };

    jest.clearAllMocks();
  });

  describe('getChallenge', () => {
    it('returns 400 when account is missing', async () => {
      mockRequest.body = {};

      await getChallenge(mockRequest as Request, mockResponse as Response, mockRedisService as RedisService);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'account parameter is required'
      });
    });

    it('generates and stores challenge successfully', async () => {
      mockRequest.body = { account: 'GBAD_PUBLIC_KEY' };
      (authService.generateChallenge as jest.Mock).mockReturnValue('test-challenge');
      (authService.storeChallenge as jest.Mock).mockResolvedValue(undefined);

      await getChallenge(mockRequest as Request, mockResponse as Response, mockRedisService as RedisService);

      expect(authService.generateChallenge).toHaveBeenCalled();
      expect(authService.storeChallenge).toHaveBeenCalledWith(
        mockRedisService,
        'GBAD_PUBLIC_KEY',
        'test-challenge'
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        transaction: 'test-challenge',
        network_passphrase: 'Test SDF Network ; September 2015'
      });
    });

    it('returns 500 when challenge generation fails', async () => {
      mockRequest.body = { account: 'GBAD_PUBLIC_KEY' };
      (authService.generateChallenge as jest.Mock).mockImplementation(() => {
        throw new Error('Redis error');
      });

      await getChallenge(mockRequest as Request, mockResponse as Response, mockRedisService as RedisService);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to generate challenge'
      });
    });
  });

  describe('getToken', () => {
    it('returns 400 when transaction is missing', async () => {
      mockRequest.body = {};

      await getToken(mockRequest as Request, mockResponse as Response, mockRedisService as RedisService);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'transaction parameter is required'
      });
    });

    it('returns 400 when challenge is invalid', async () => {
      mockRequest.body = { transaction: 'invalid-challenge' };
      (authService.getChallenge as jest.Mock).mockResolvedValue(null);

      await getToken(mockRequest as Request, mockResponse as Response, mockRedisService as RedisService);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid or expired challenge'
      });
    });

    it('returns token when challenge is valid', async () => {
      mockRequest.body = { transaction: 'valid-challenge' };
      const mockChallenge = {
        challenge: 'valid-challenge',
        publicKey: 'GBAD_PUBLIC_KEY',
        createdAt: Date.now()
      };
      
      (authService.getChallenge as jest.Mock).mockResolvedValue(mockChallenge);
      (authService.removeChallenge as jest.Mock).mockResolvedValue(undefined);
      (authService.signToken as jest.Mock).mockReturnValue('jwt-token');

      await getToken(mockRequest as Request, mockResponse as Response, mockRedisService as RedisService);

      expect(authService.removeChallenge).toHaveBeenCalledWith(mockRedisService, 'GBAD_PUBLIC_KEY');
      expect(authService.signToken).toHaveBeenCalledWith('GBAD_PUBLIC_KEY');
      expect(mockResponse.json).toHaveBeenCalledWith({
        token: 'jwt-token',
        type: 'bearer',
        expires_in: 3600
      });
    });

    it('returns 500 when token generation fails', async () => {
      mockRequest.body = { transaction: 'valid-challenge' };
      (authService.getChallenge as jest.Mock).mockImplementation(() => {
        throw new Error('Redis error');
      });

      await getToken(mockRequest as Request, mockResponse as Response, mockRedisService as RedisService);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to verify challenge'
      });
    });
  });
});