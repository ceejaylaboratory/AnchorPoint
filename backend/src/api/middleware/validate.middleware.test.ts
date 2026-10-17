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

    it('should return 400 on invalid body with standardized error format and field details', async () => {
      const res = await request(app)
        .post('/test')
        .send({ name: '', age: -5 });
      expect(res.statusCode).toEqual(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toEqual('VALIDATION_ERROR');
      expect(res.body.error.message).toEqual('Validation failed');
      expect(res.body.error.details.issues).toHaveLength(2);
      expect(res.body.error.details.fields).toHaveProperty('name');
      expect(res.body.error.details.fields).toHaveProperty('age');
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

    it('should return 400 on invalid query with standardized error format', async () => {
      const res = await request(app)
        .get('/test/not-a-uuid')
        .query({ page: 'abc' });
      expect(res.statusCode).toEqual(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toEqual('VALIDATION_ERROR');
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

    it('should return 400 on invalid params with standardized error format', async () => {
      const res = await request(app)
        .get('/test/invalid-id')
        .query({ page: '1' });
      expect(res.statusCode).toEqual(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toEqual('VALIDATION_ERROR');
    });

    it('should return non-200 on missing params when required', async () => {
      const res = await request(app)
        .get('/test/')
        .query({ page: '1' });
      expect(res.statusCode).not.toEqual(200);
    });
  });

  describe('Internal Server Error', () => {
    it('should return 500 on unexpected non-Zod errors with standardized error format', async () => {
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
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toEqual('INTERNAL_SERVER_ERROR');
      expect(res.body.error.message).toEqual('Internal server error during validation');
    });
  });
});
