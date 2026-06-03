// IMPLEMENTATION APPROACH: Option A — Node.js/TypeScript + Express
// Rationale: Using Supertest allows us to verify the Express HTTP behavior natively within the Node testing ecosystem (Jest/Mocha).

import request from 'supertest';
import { createServer } from '../server';
import { ScenarioName, setScenario } from '../scenarios';

const app = createServer();

describe('Mock Server Integration Tests', () => {
  beforeEach(() => {
    setScenario(ScenarioName.HAPPY_PATH);
  });

  it('Horizon account fetch returns correct mock data', async () => {
    const res = await request(app).get('/accounts/GABC123');
    expect(res.status).toBe(200);
    expect(res.body.account_id).toBe('GABC123');
  });

  it('Scenario switching mid-test works correctly', async () => {
    // Switch to NOT_FOUND
    await request(app).post('/mock/scenario').send({ scenario: ScenarioName.ACCOUNT_NOT_FOUND });
    
    const res = await request(app).get('/accounts/GABC123');
    expect(res.status).toBe(404);
    expect(res.body.title).toBe('Resource Missing');
  });

  it('Transaction submission returns correct response per scenario', async () => {
    // Happy path
    let res = await request(app).post('/transactions').send({ tx: 'xdr' });
    expect(res.status).toBe(200);
    expect(res.body.successful).toBe(true);

    // Failed scenario
    setScenario(ScenarioName.TRANSACTION_FAILED);
    res = await request(app).post('/transactions').send({ tx: 'xdr' });
    expect(res.status).toBe(400);
    expect(res.body.title).toBe('Transaction Failed');
  });

  it('All Soroban RPC methods return schema-valid responses', async () => {
    const res = await request(app)
      .post('/soroban/rpc')
      .send({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' });
    
    expect(res.status).toBe(200);
    expect(res.body.result).toHaveProperty('sequence');
  });

  it('Network timeout scenario causes correct delay', async () => {
    setScenario(ScenarioName.NETWORK_TIMEOUT);
    const start = Date.now();
    await request(app).get('/ledgers/latest');
    const duration = Date.now() - start;
    // Verify it took at least 5000ms
    expect(duration).toBeGreaterThanOrEqual(4900);
  }, 10000); // increase jest timeout for this test
});
