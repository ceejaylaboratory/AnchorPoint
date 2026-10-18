import { API_KEY_FORMAT, ApiKeyFormatError, ApiKeyService } from './api-key.service';
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
    jest.restoreAllMocks();
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

  it('should store keys that match the API key format', async () => {
    (prisma.apiKey.create as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ id: '1', isActive: true, createdAt: new Date(), ...data }),
    );

    const result = await service.createKey('user1', 'Pro');

    expect(result.key).toMatch(API_KEY_FORMAT);
    const stored = (prisma.apiKey.create as jest.Mock).mock.calls[0][0].data.key;
    expect(stored).toMatch(API_KEY_FORMAT);
  });

  it('should refuse to store a malformed generated key', async () => {
    jest
      .spyOn(crypto, 'randomBytes')
      .mockImplementation(() => Buffer.from('short') as any);

    await expect(service.createKey('user1', 'Pro')).rejects.toBeInstanceOf(ApiKeyFormatError);
    expect(prisma.apiKey.create).not.toHaveBeenCalled();
  });
});
