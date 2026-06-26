import request from 'supertest';
import app from '../../src/index';
import { relayerService } from '../../src/services/relayer.service';

jest.mock('../../src/services/relayer.service');

describe('Relayer retry integration test', () => {
  const approvalReq = {
    userPublicKey: 'GABCD',
    spenderPublicKey: 'GXYZ',
    amount: '100',
    nonce: 'nonce123',
    expiry: Math.floor(Date.now() / 1000) + 600,
    signature: 'base64sig',
  };

  it('should retry on transient error and eventually succeed', async () => {
    const mockProcess = relayerService.processApprovalRequest as jest.Mock;
    // First call throws a transient error, second call succeeds
    mockProcess
      .mockRejectedValueOnce(new Error('Transient error'))
      .mockResolvedValueOnce({ success: true, transactionHash: 'hash123' });

    const response = await request(app).post('/api/relayer/approve').send(approvalReq);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.transactionHash).toBe('hash123');
    expect(mockProcess).toHaveBeenCalledTimes(2);
  });
});
