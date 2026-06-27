import { Request, Response } from 'express';
import { getChallenge } from '../api/controllers/auth.controller';
import { RedisService } from '../services/redis.service';

jest.mock('../services/auth.service', () => ({
  generateChallenge: () => 'mock-challenge',
  generateMultiKeyChallenge: jest.fn(),
  storeChallenge: jest.fn().mockResolvedValue(undefined),
  getChallenge: jest.fn(),
  removeChallenge: jest.fn(),
  signToken: jest.fn().mockReturnValue('mock-token'),
  verifyToken: jest.fn(),
  validateMultiKeySignatures: jest.fn(),
  generateSep10ChallengeTransaction: jest.fn().mockReturnValue({
    transactionXdr: 'mock-xdr',
    challenge: 'mock-challenge',
    networkPassphrase: 'Test SDF Network ; September 2015',
  }),
  storeSep10Challenge: jest.fn().mockResolvedValue(undefined),
  verifySep10ChallengeTransaction: jest.fn(),
}));

jest.mock('../utils/sep10-stellar', () => ({
  extractAccountFromSep10Transaction: jest.fn(),
}));

jest.mock('../config/env', () => ({
  config: {
    ANCHOR_PUBLIC_KEY: 'GBADPUBLICKEY',
    STELLAR_NETWORK: 'testnet',
    STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    PORT: 3001,
  },
}));

jest.mock('../utils/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function makeReq(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

function makeRes(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

const mockRedis = {} as RedisService;

describe('getChallenge — client_domain validation', () => {
  it('accepts request without client_domain', async () => {
    const req = makeReq({ account: 'GABCDE' });
    const { res, status } = makeRes();
    await getChallenge(req, res, mockRedis);
    expect(status).not.toHaveBeenCalledWith(400);
  });

  it('accepts valid domain: example.com', async () => {
    const req = makeReq({ account: 'GABCDE', client_domain: 'example.com' });
    const { res, status } = makeRes();
    await getChallenge(req, res, mockRedis);
    expect(status).not.toHaveBeenCalledWith(400);
  });

  it('accepts valid domain: wallet.example.com', async () => {
    const req = makeReq({ account: 'GABCDE', client_domain: 'wallet.example.com' });
    const { res, status } = makeRes();
    await getChallenge(req, res, mockRedis);
    expect(status).not.toHaveBeenCalledWith(400);
  });

  it('accepts valid domain: sub.domain.co.uk', async () => {
    const req = makeReq({ account: 'GABCDE', client_domain: 'sub.domain.co.uk' });
    const { res, status } = makeRes();
    await getChallenge(req, res, mockRedis);
    expect(status).not.toHaveBeenCalledWith(400);
  });

  it('rejects http:// prefix', async () => {
    const req = makeReq({ account: 'GABCDE', client_domain: 'http://example.com' });
    const { res, status, json } = makeRes();
    await getChallenge(req, res, mockRedis);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_client_domain' })
    );
  });

  it('rejects https:// prefix', async () => {
    const req = makeReq({ account: 'GABCDE', client_domain: 'https://example.com' });
    const { res, status, json } = makeRes();
    await getChallenge(req, res, mockRedis);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_client_domain' })
    );
  });

  it('rejects javascript: protocol', async () => {
    const req = makeReq({ account: 'GABCDE', client_domain: 'javascript:alert(1)' });
    const { res, status, json } = makeRes();
    await getChallenge(req, res, mockRedis);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_client_domain' })
    );
  });

  it('rejects whitespace-only string', async () => {
    const req = makeReq({ account: 'GABCDE', client_domain: '   ' });
    const { res, status, json } = makeRes();
    await getChallenge(req, res, mockRedis);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_client_domain' })
    );
  });

  it('rejects empty string', async () => {
    const req = makeReq({ account: 'GABCDE', client_domain: '' });
    const { res, status, json } = makeRes();
    await getChallenge(req, res, mockRedis);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_client_domain' })
    );
  });
});
