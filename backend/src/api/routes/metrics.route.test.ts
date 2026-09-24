import express from 'express';
import request from 'supertest';
import metricsRouter from './metrics.route';

const app = express();
app.use('/metrics', metricsRouter);

describe('GET /metrics access guard (#1202)', () => {
  afterEach(() => {
    delete process.env.METRICS_AUTH_TOKEN;
    delete process.env.METRICS_IP_WHITELIST;
  });

  it('serves Prometheus text format when no guard is configured', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('# TYPE http_request_duration_seconds histogram');
  });

  it('rejects requests without a valid token when METRICS_AUTH_TOKEN is set', async () => {
    process.env.METRICS_AUTH_TOKEN = 'scrape-secret';

    expect((await request(app).get('/metrics')).status).toBe(403);
    expect((await request(app).get('/metrics').set('Authorization', 'Bearer wrong')).status).toBe(403);
    expect((await request(app).get('/metrics/json')).status).toBe(403);
  });

  it('accepts a valid bearer token', async () => {
    process.env.METRICS_AUTH_TOKEN = 'scrape-secret';

    const res = await request(app).get('/metrics').set('Authorization', 'Bearer scrape-secret');
    expect(res.status).toBe(200);
  });

  it('accepts requests from a whitelisted IP', async () => {
    process.env.METRICS_IP_WHITELIST = '10.0.0.5, 127.0.0.1';

    expect((await request(app).get('/metrics')).status).toBe(200);
  });

  it('rejects requests from IPs not on the whitelist', async () => {
    process.env.METRICS_IP_WHITELIST = '10.0.0.5';

    expect((await request(app).get('/metrics')).status).toBe(403);
  });
});
