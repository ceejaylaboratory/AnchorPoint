import { ApiKeyService } from './api-key.service';
import prisma from '../lib/prisma';
import crypto from 'crypto';

jest.mock('../lib/prisma', () => {
  return {
    __esModule: true,
    default: {
      apiKey: {
        create: jest.fn(),
        findUnique: jest.fn(),
      }
    }
  };
});

describe('ApiKeyService', () => {
  let service: ApiKeyService;

  beforeEach(() => {
    service = new ApiKeyService();
    jest.clearAllMocks();
  });

  it('should generate a new API key', async () => {
    (prisma.apiKey.create as jest.Mock).mockResolvedValue({
      id: '1',
      key: 'generated-key',
      ownerId: 'user1',
      tier: 'Pro',
      isActive: true,
      createdAt: new Date(),
    });

    const result = await service.createKey('user1', 'Pro');
    expect(result.id).toBe('1');
    expect(result.key).toBe('generated-key');
    expect(result.ownerId).toBe('user1');
    expect(result.tier).toBe('Pro');
    
    expect(prisma.apiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: 'user1',
        tier: 'Pro',
        key: expect.any(String),
      })
    });
  });
});
