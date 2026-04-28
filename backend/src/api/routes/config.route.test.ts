import request from 'supertest';
import express from 'express';
import configRouter from './config.route';
import { configService } from '../../services/config.service';

const app = express();
app.use(express.json());
app.use('/api/config', configRouter);

jest.mock('../../services/config.service', () => {
  const mockService = {
    getConfig: jest.fn(),
    getHistory: jest.fn(),
    updateConfig: jest.fn(),
    rollbackToVersion: jest.fn(),
  };
  return {
    __esModule: true,
    configService: mockService,
    default: mockService,
  };
});

describe('Config API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/config', () => {
    it('should return the current configuration', async () => {
      const mockConfig = { JWT_SECRET: 'test' };
      (configService.getConfig as jest.Mock).mockReturnValue(mockConfig);

      const response = await request(app).get('/api/config');
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(mockConfig);
    });
  });

  describe('POST /api/config', () => {
    it('should update configuration successfully', async () => {
      const newConfig = { JWT_SECRET: 'new' };
      (configService.updateConfig as jest.Mock).mockResolvedValue({ version: 2 });

      const response = await request(app)
        .post('/api/config')
        .send(newConfig);

      expect(response.status).toBe(200);
      expect(response.body.data.version).toBe(2);
      expect(configService.updateConfig).toHaveBeenCalledWith(newConfig);
    });

    it('should handle validation errors', async () => {
      const error = new Error(JSON.stringify([{ message: 'Required' }]));
      error.name = 'ZodError';
      (configService.updateConfig as jest.Mock).mockRejectedValue(error);

      const response = await request(app)
        .post('/api/config')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toBe('Validation failed');
    });
  });

  describe('POST /api/config/rollback/:version', () => {
    it('should rollback configuration', async () => {
      (configService.rollbackToVersion as jest.Mock).mockResolvedValue({ version: 3 });

      const response = await request(app).post('/api/config/rollback/1');
      expect(response.status).toBe(200);
      expect(response.body.data.version).toBe(3);
      expect(configService.rollbackToVersion).toHaveBeenCalledWith(1);
    });

    it('should return 400 for invalid version format', async () => {
      const response = await request(app).post('/api/config/rollback/abc');
      expect(response.status).toBe(400);
    });
  });
});
