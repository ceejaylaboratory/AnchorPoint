// IMPLEMENTATION APPROACH: Option A — Node.js/TypeScript + Express
// Rationale: Using Supertest mirrors the existing mock-server.test.ts pattern
// so the test suite is consistent.

import request from 'supertest';
import { createServer } from '../server';
import { clearFault, getActiveFault, FaultType } from '../faults';

const app = createServer();

describe('Fault Injection — /mock/faults', () => {
  // Reset fault state before each test so tests are independent.
  beforeEach(() => {
    clearFault();
  });

  // ---------------------------------------------------------------------------
  // GET /mock/faults — read current state
  // ---------------------------------------------------------------------------

  it('GET /mock/faults returns NONE when no fault is active', async () => {
    const res = await request(app).get('/mock/faults');
    expect(res.status).toBe(200);
    expect(res.body.activeFault.errorType).toBe('NONE');
  });

  // ---------------------------------------------------------------------------
  // POST /mock/faults — activate a fault
  // ---------------------------------------------------------------------------

  it('POST /mock/faults with RATE_LIMIT activates the fault', async () => {
    const res = await request(app)
      .post('/mock/faults')
      .send({ errorType: 'RATE_LIMIT' });

    expect(res.status).toBe(200);
    expect(res.body.activeFault.errorType).toBe('RATE_LIMIT');
    expect(getActiveFault().errorType).toBe('RATE_LIMIT');
  });

  it('POST /mock/faults with RPC_DOWN activates the fault', async () => {
    const res = await request(app)
      .post('/mock/faults')
      .send({ errorType: 'RPC_DOWN' });

    expect(res.status).toBe(200);
    expect(res.body.activeFault.errorType).toBe('RPC_DOWN');
  });

  it('POST /mock/faults with INVALID_HASH activates the fault', async () => {
    const res = await request(app)
      .post('/mock/faults')
      .send({ errorType: 'INVALID_HASH' });

    expect(res.status).toBe(200);
    expect(res.body.activeFault.errorType).toBe('INVALID_HASH');
  });

  it('POST /mock/faults with NONE clears any active fault', async () => {
    // First activate something
    await request(app).post('/mock/faults').send({ errorType: 'RPC_DOWN' });
    // Then clear it via the API
    const res = await request(app)
      .post('/mock/faults')
      .send({ errorType: 'NONE' });

    expect(res.status).toBe(200);
    expect(res.body.activeFault.errorType).toBe('NONE');
  });

  it('POST /mock/faults respects a custom delayMs value', async () => {
    const res = await request(app)
      .post('/mock/faults')
      .send({ errorType: 'TIMEOUT', delayMs: 100 });

    expect(res.status).toBe(200);
    expect(res.body.activeFault.delayMs).toBe(100);
    expect(getActiveFault().delayMs).toBe(100);
  });

  it('POST /mock/faults uses 5000 ms default when delayMs is omitted', async () => {
    const res = await request(app)
      .post('/mock/faults')
      .send({ errorType: 'RATE_LIMIT' });

    expect(res.status).toBe(200);
    expect(res.body.activeFault.delayMs).toBe(5000);
  });

  it('POST /mock/faults rejects an unknown errorType with 400', async () => {
    const res = await request(app)
      .post('/mock/faults')
      .send({ errorType: 'EXPLODE' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/TIMEOUT|RATE_LIMIT|RPC_DOWN/);
  });

  it('POST /mock/faults rejects a missing errorType with 400', async () => {
    const res = await request(app)
      .post('/mock/faults')
      .send({});

    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // DELETE /mock/faults — clear fault
  // ---------------------------------------------------------------------------

  it('DELETE /mock/faults resets fault to NONE', async () => {
    await request(app).post('/mock/faults').send({ errorType: 'RATE_LIMIT' });

    const res = await request(app).delete('/mock/faults');
    expect(res.status).toBe(200);
    expect(res.body.activeFault.errorType).toBe('NONE');
    expect(getActiveFault().errorType).toBe('NONE');
  });

  // ---------------------------------------------------------------------------
  // Fault injection effect on downstream routes
  // ---------------------------------------------------------------------------

  it('RATE_LIMIT fault causes /accounts/:id to return 429', async () => {
    // Activate fault
    await request(app).post('/mock/faults').send({ errorType: 'RATE_LIMIT' });

    const res = await request(app).get('/accounts/GABC123');
    expect(res.status).toBe(429);
    expect(res.body.title).toBe('Too Many Requests');
  });

  it('RPC_DOWN fault causes /soroban/rpc to return 503', async () => {
    await request(app).post('/mock/faults').send({ errorType: 'RPC_DOWN' });

    const res = await request(app)
      .post('/soroban/rpc')
      .send({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' });
    expect(res.status).toBe(503);
    expect(res.body.title).toBe('Service Unavailable');
  });

  it('TIMEOUT fault causes /accounts/:id to return 504 with custom delayMs', async () => {
    // Use a very short delay so the test suite stays fast
    await request(app)
      .post('/mock/faults')
      .send({ errorType: 'TIMEOUT', delayMs: 50 });

    const res = await request(app).get('/accounts/GABC123');
    expect(res.status).toBe(504);
    expect(res.body.title).toBe('Gateway Timeout');
  }, 3000);

  it('Clearing a fault restores normal behaviour on downstream routes', async () => {
    await request(app).post('/mock/faults').send({ errorType: 'RPC_DOWN' });
    // Confirm fault is active
    let res = await request(app).get('/accounts/GABC123');
    expect(res.status).toBe(503);

    // Clear fault
    await request(app).delete('/mock/faults');

    // Normal response should be restored
    res = await request(app).get('/accounts/GABC123');
    expect(res.status).toBe(200);
    expect(res.body.account_id).toBe('GABC123');
  });
});
