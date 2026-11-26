import request from 'supertest';
import express, { Request, Response } from 'express';
import {
  sanitizationMiddleware,
  sanitizeForPrototypePollution,
  containsForbiddenKey,
} from './sanitization.middleware';

const app = express();
app.use(express.json());
app.use(sanitizationMiddleware());

app.post('/echo', (req: Request, res: Response) => res.json(req.body));
app.get('/echo', (req: Request, res: Response) => res.json(req.query));

const strictApp = express();
strictApp.use(express.json());
strictApp.use(sanitizationMiddleware({ rejectForbiddenKeys: true }));
strictApp.post('/echo', (req: Request, res: Response) => res.json(req.body));

describe('Prototype pollution sanitization middleware', () => {
  it('strips __proto__, constructor and prototype keys from nested body objects', async () => {
    const payload = JSON.parse(
      '{"safe":{"name":"Alice"},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true}}'
    );
    const res = await request(app).post('/echo').send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ safe: { name: 'Alice' } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('strips forbidden keys from query parameters and route params', async () => {
    const res = await request(app)
      .get('/echo?name=Alice&__proto__[polluted]=true&constructor[x]=1')
      .expect(200);

    expect(res.body.name).toBe('Alice');
    expect(Object.prototype.hasOwnProperty.call(res.body, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'constructor')).toBe(false);
  });

  it('preserves legitimate deeply nested properties and arrays', async () => {
    const payload = {
      user: { profile: { name: 'Bob', roles: ['admin', 'user'] } },
      items: [{ id: 1, meta: { active: true } }],
    };
    const res = await request(app).post('/echo').send(payload);

    expect(res.body).toEqual(payload);
  });

  it('rejects malicious payloads with HTTP 400 in strict mode', async () => {
    const payload = JSON.parse('{"name":"Alice","constructor":{"prototype":{"x":1}}}');
    const res = await request(strictApp).post('/echo').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSAFE_INPUT');
  });

  it('rejects clean payloads in strict mode', async () => {
    const res = await request(strictApp).post('/echo').send({ name: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Alice' });
  });

  it('detects forbidden keys without mutating the source', () => {
    const payload = JSON.parse('{"a":1,"__proto__":{"polluted":true}}');
    expect(containsForbiddenKey(payload)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(payload, '__proto__')).toBe(true);
    expect(containsForbiddenKey({ a: { b: 2 } })).toBe(false);
  });

  it('handles cyclic structures and large payloads without overflowing', () => {
    const cyclic: Record<string, unknown> = { safe: 1 };
    cyclic.self = cyclic;
    const result = sanitizeForPrototypePollution(cyclic);
    expect(result.value).toMatchObject({ safe: 1 });

    const large: Record<string, number> = {};
    for (let i = 0; i < 10000; i += 1) large[`key${i}`] = i;
    expect(Object.keys(sanitizeForPrototypePollution(large).value as object)).toHaveLength(10000);
  });
});
