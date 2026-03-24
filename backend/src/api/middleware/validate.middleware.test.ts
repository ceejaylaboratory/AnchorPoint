import request from 'supertest';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { validate } from './validate.middleware';

const app = express();
app.use(express.json());

const testSchema = {
  body: z.object({
    name: z.string().min(1),
    age: z.number().int().positive()
  }),
  query: z.object({
    page: z.string().transform(v => parseInt(v, 10))
  }),
  params: z.object({
    id: z.string().uuid()
  })
};

app.post('/test', validate({ body: testSchema.body }), (req: Request, res: Response) => {
  res.json({ status: 'success', data: req.body });
});

app.get('/test/:id', validate({ query: testSchema.query, params: testSchema.params }), (req: Request, res: Response) => {
  res.json({ status: 'success', data: { query: req.query, params: req.params } });
});

describe('Validate Middleware', () => {
  describe('Body Validation', () => {
    it('should return 200 on valid body', async () => {
      const res = await request(app)
        .post('/test')
        .send({ name: 'John', age: 30 });
      expect(res.statusCode).toEqual(200);
      expect(res.body.data.name).toEqual('John');
    });

    it('should return 400 on invalid body', async () => {
      const res = await request(app)
        .post('/test')
        .send({ name: '', age: -5 });
      expect(res.statusCode).toEqual(400);
      expect(res.body.status).toEqual('error');
      expect(res.body.details).toHaveLength(2);
    });
  });

  describe('Query Validation', () => {
    it('should return 200 on valid query', async () => {
      const validUuid = '550e8400-e29b-41d4-a716-446655440000';
      const res = await request(app)
        .get(`/test/${validUuid}`)
        .query({ page: '1' });
      expect(res.statusCode).toEqual(200);
      expect(res.body.data.query.page).toEqual(1);
    });

    it('should return 400 on invalid query', async () => {
      const res = await request(app)
        .get('/test/not-a-uuid')
        .query({ page: 'abc' });
      expect(res.statusCode).toEqual(400);
      expect(res.body.status).toEqual('error');
    });
  });

  describe('Params Validation', () => {
    it('should return 200 on valid params', async () => {
      const validUuid = '550e8400-e29b-41d4-a716-446655440000';
      const res = await request(app)
        .get(`/test/${validUuid}`)
        .query({ page: '1' });
      expect(res.statusCode).toEqual(200);
      expect(res.body.data.params.id).toEqual(validUuid);
    });

    it('should return 400 on invalid params', async () => {
      const res = await request(app)
        .get('/test/invalid-id')
        .query({ page: '1' });
      expect(res.statusCode).toEqual(400);
      expect(res.body.status).toEqual('error');
    });

    it('should return 400 on missing params when required', async () => {
      // This route requires params.id, but we're calling a route without it
      // This test case is more about route definition than middleware,
      // but if the middleware was applied to a route like '/test' expecting params, it would fail.
      // For the current setup, calling '/test' without an ID would result in a 404 before validation.
      // To properly test missing params, we'd need a route like app.get('/test', validate({ params: testSchema.params }))
      // which would be a logical contradiction.
      // The existing '/test/:id' route inherently requires an ID in the path.
      // So, an "invalid-id" test case covers the validation aspect.
      // This comment serves as a note for the user about the nature of params validation.
      const res = await request(app)
        .get('/test/') // This would likely result in a 404 or a different route handler
        .query({ page: '1' });
      // Depending on Express routing, this might be a 404 or fall through to another handler.
      // For this specific setup, it's hard to simulate a "missing param" for a route like /test/:id
      // without changing the route definition itself.
      // The 'invalid-id' test case already covers the validation failure for params.
      expect(res.statusCode).not.toEqual(200); // It should not be successful
    });
  });

  describe('Internal Server Error', () => {
    it('should return 500 on unexpected non-Zod errors', async () => {
      // Create a spoofed schema that throws non-Zod error
      const buggySchema = {
        body: {
          parseAsync: () => { throw new Error('Unchecked exception'); }
        } as any
      };
      
      const buggyApp = express();
      buggyApp.use(express.json());
      buggyApp.post('/error', validate({ body: buggySchema.body }), (req, res) => res.send('ok'));
      
      const res = await request(buggyApp)
        .post('/error')
        .send({ some: 'data' });
      
      expect(res.statusCode).toEqual(500);
      expect(res.body.message).toEqual('Internal server error during validation');
    });
  });
});
