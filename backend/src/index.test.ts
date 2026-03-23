import request from 'supertest';
import app from './index';

describe('Backend API', () => {
  it('should return UP on health check', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('UP');
  });

  it('should return 200 on root access', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toContain('AnchorPoint Backend API is running.');
  });
});
