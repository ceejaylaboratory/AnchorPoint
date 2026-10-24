import { createKey } from './api-keys.controller';
import { ApiKeyFormatError, ApiKeyService } from '../../services/api-key.service';
import prisma from '../../lib/prisma';

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
  },
}));

const mockResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('api-keys controller: createKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user1' });
  });

  it('returns 500 when the generated key fails format validation', async () => {
    const service = { createKey: jest.fn().mockRejectedValue(new ApiKeyFormatError()) } as unknown as ApiKeyService;
    const req: any = { user: { publicKey: 'GABC' }, body: { tier: 'Pro' } };
    const res = mockResponse();

    await createKey(service)(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to generate a valid API key' });
  });

  it('returns 201 with the created key on success', async () => {
    const record = { id: '1', key: 'a'.repeat(48), ownerId: 'user1', tier: 'Pro' };
    const service = { createKey: jest.fn().mockResolvedValue(record) } as unknown as ApiKeyService;
    const req: any = { user: { publicKey: 'GABC' }, body: { tier: 'Pro' } };
    const res = mockResponse();

    await createKey(service)(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(record);
  });
});
