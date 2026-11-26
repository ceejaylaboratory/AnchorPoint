const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $use: jest.fn(),
    $extends: jest.fn(),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../services/crypto.service', () => ({
  piiEncryptionMiddleware: jest.fn(),
}));

describe('buildDatabaseUrl (#1588)', () => {
  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    jest.resetModules();
  });

  it('adds pool, SSL, timeout and keepalive parameters for PostgreSQL', () => {
    jest.resetModules();
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/anchorpoint';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildDatabaseUrl } = require('./prisma') as typeof import('./prisma');
    const parsed = new URL(buildDatabaseUrl());

    expect(parsed.searchParams.get('connection_limit')).toBe('10');
    expect(parsed.searchParams.get('pool_timeout')).toBe('5');
    expect(parsed.searchParams.get('sslmode')).toBe('disable');
    expect(parsed.searchParams.get('connect_timeout')).toBe('10');
    expect(parsed.searchParams.get('keepalives')).toBe('1');
    expect(parsed.searchParams.get('keepalives_idle')).toBe('15');
    expect(parsed.searchParams.get('keepalives_interval')).toBe('5');
    expect(parsed.searchParams.get('keepalives_count')).toBe('3');
  });

  it('preserves existing query parameters without duplicating explicit ones', () => {
    jest.resetModules();
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db?application_name=anchor&keepalives=0';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildDatabaseUrl } = require('./prisma') as typeof import('./prisma');
    const parsed = new URL(buildDatabaseUrl());

    expect(parsed.searchParams.get('application_name')).toBe('anchor');
    expect(parsed.searchParams.get('keepalives')).toBe('1');
  });

  it('leaves SQLite datasource URLs untouched', () => {
    jest.resetModules();
    process.env.DATABASE_URL = 'file:./prisma/test.db';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildDatabaseUrl } = require('./prisma') as typeof import('./prisma');
    expect(buildDatabaseUrl()).toBe('file:./prisma/test.db');
  });
});
