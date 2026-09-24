import request from 'supertest';
import express, { Request, Response } from 'express';
import { sanitizeRequestMiddleware, sanitizeValue } from './sanitize.middleware';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeRequestMiddleware);

app.post('/echo', (req: Request, res: Response) => {
  res.json(req.body);
});

app.get('/echo', (req: Request, res: Response) => {
  res.json(req.query);
});

const nested = express.Router();
nested.get('/:id', (req: Request, res: Response) => {
  res.json(req.params);
});
app.use('/items', nested);

describe('Sanitize Request Middleware', () => {
  it('strips HTML and script tags from string input values', async () => {
    const res = await request(app).post('/echo').send({
      name: '<script>alert("xss")</script>Alice',
      note: '<b>hello</b> <img src=x onerror=alert(1)>',
    });

    expect(res.status).toEqual(200);
    expect(res.body.name).toEqual('Alice');
    expect(res.body.note).toEqual('hello');
  });

  it('recursively trims whitespace from string payload parameters', async () => {
    const res = await request(app).post('/echo').send({
      address: '  123 Main St  ',
      nested: {
        city: '\t  New York \n',
        tags: ['  alpha ', 'beta  '],
      },
    });

    expect(res.body.address).toEqual('123 Main St');
    expect(res.body.nested.city).toEqual('New York');
    expect(res.body.nested.tags).toEqual(['alpha', 'beta']);
  });

  it('preserves non-string values (numbers, booleans, null)', async () => {
    const res = await request(app).post('/echo').send({
      amount: 42,
      active: true,
      empty: null,
    });

    expect(res.body.amount).toEqual(42);
    expect(res.body.active).toEqual(true);
    expect(res.body.empty).toEqual(null);
  });

  it('sanitizes SQL-injection style payload fragments', async () => {
    const res = await request(app).post('/echo').send({
      query: "'; DROP TABLE users; --",
      where: '<script>SELECT * FROM users</script>',
    });

    expect(res.status).toEqual(200);
    expect(res.body.query).toEqual("'; DROP TABLE users; --");
    expect(res.body.where).toEqual('');
  });

  it('does not throw on empty or non-object bodies', async () => {
    const res = await request(app).post('/echo').send();

    expect(res.status).toEqual(200);
    expect(res.body).toEqual({});
  });

  it('handles urlencoded bodies', async () => {
    const res = await request(app)
      .post('/echo')
      .type('form')
      .send('name=<b>Bold</b>&city=  Lagos  ');

    expect(res.status).toEqual(200);
    expect(res.body.name).toEqual('Bold');
    expect(res.body.city).toEqual('Lagos');
  });

  it('strips script tags from query string values', async () => {
    const res = await request(app)
      .get('/echo')
      .query({ search: '<script>alert(1)</script>books', tags: ['<b>a</b>', ' b '] });

    expect(res.status).toEqual(200);
    expect(res.body.search).toEqual('books');
    expect(res.body.tags).toEqual(['a', 'b']);
  });

  it('strips script tags from route params populated by nested routers', async () => {
    const res = await request(app).get(
      `/items/${encodeURIComponent('<script>alert(1)</script>abc')}`,
    );

    expect(res.status).toEqual(200);
    expect(res.body.id).toEqual('abc');
  });

  it('sanitizeValue strips tags and trims standalone strings', () => {
    expect(sanitizeValue('<script>alert(1)</script>  hello  ')).toEqual('hello');
    expect(sanitizeValue(123)).toEqual(123);
    expect(sanitizeValue([' a ', '<i>b</i>'])).toEqual(['a', 'b']);
    expect(sanitizeValue({ k: '<p>x</p> ' })).toEqual({ k: 'x' });
  });
});