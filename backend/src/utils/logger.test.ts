import os from 'os';
import fs from 'fs';
import path from 'path';

describe('Logger', () => {
  const loadLogger = async () => {
    jest.resetModules();
    const mod = await import('./logger');
    return mod.default;
  };

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_DIR;
    delete process.env.NODE_ENV;
  });

  it('uses LOG_LEVEL when it is valid', async () => {
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'warn';

    const logger = await loadLogger();
    expect((logger as any).level).toBe('warn');
  });

  it('falls back to debug when LOG_LEVEL is invalid and not in production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'nope';

    const logger = await loadLogger();
    expect((logger as any).level).toBe('debug');
  });

  it('defaults to info and adds file transports in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'nope';
    process.env.LOG_DIR = os.tmpdir();

    const logger = await loadLogger();

    expect((logger as any).level).toBe('info');
    // Console transport + error.log + combined.log should exist.
    expect((logger as any).transports.length).toBeGreaterThanOrEqual(3);
  });

  it('uses default log dir in production when LOG_DIR is unset', async () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'nope';

    const logDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const logger = await loadLogger();
    expect((logger as any).level).toBe('info');
  });

  it('logs without throwing (smoke test)', async () => {
    process.env.NODE_ENV = 'test';
    const logger = await loadLogger();

    expect(() => logger.info('Test info message')).not.toThrow();
    expect(() => logger.error('Test error message')).not.toThrow();
    expect(() => logger.warn('Test warning message')).not.toThrow();
    expect(() => logger.debug('Test debug message')).not.toThrow();
    expect(() => logger.error(new Error('Test error'))).not.toThrow();
  });

  it('Issue #916: attaches correlationId to log info when active in tracing context', async () => {
    const { correlationIdFormat } = await import('./logger');
    const { tracingManager } = await import('./tracing');

    const format = correlationIdFormat();
    const result = tracingManager.runWithContext({ correlationId: 'corr-xyz-123' }, () => {
      return format.transform({ level: 'info', message: 'Hello' }, {});
    });

    expect((result as any).correlationId).toBe('corr-xyz-123');
  });

  it('masks sensitive PII keys (secret, token, password, tax_id, email)', async () => {
    const { maskPIIFormat } = await import('./logger');
    const format = maskPIIFormat();

    const result = format.transform({
      level: 'info',
      message: 'User logged in',
      password: 'my-super-secret-password',
      email: 'user@example.com',
      nested: {
        token: 'jwt-token',
        tax_id: '123-456-789',
        safeKey: 'hello'
      }
    }, {});

    expect((result as any).password).toBe('***REDACTED***');
    expect((result as any).email).toBe('***REDACTED***');
    expect((result as any).nested.token).toBe('***REDACTED***');
    expect((result as any).nested.tax_id).toBe('***REDACTED***');
    expect((result as any).nested.safeKey).toBe('hello');
  });
});

