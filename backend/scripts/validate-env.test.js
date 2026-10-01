/**
 * Tests for tools/validate-env.js
 *
 * Runs the script as a child process to test validation logic and exit codes.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../tools/validate-env.js');

const VALID_ENV = {
  JWT_SECRET: 'a_very_long_secure_jwt_secret_32_chars_min!',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  PRODUCTION_CORS_ORIGINS: 'https://example.com,https://app.example.com',
};

function run(customEnv = {}, flags = []) {
  // Pass an isolated environment without inheriting current process.env variables that might pollute tests
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    ...customEnv,
  };
  return spawnSync(process.execPath, [SCRIPT, ...flags], {
    env,
    encoding: 'utf-8',
  });
}

describe('tools/validate-env.js', () => {
  it('exits 0 when all mandatory production variables are valid', () => {
    const result = run(VALID_ENV);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Environment validation succeeded');
  });

  it('exits 1 when JWT_SECRET is shorter than 32 characters', () => {
    const result = run({
      ...VALID_ENV,
      JWT_SECRET: 'short_secret',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('JWT_SECRET must be at least 32 characters long');
  });

  it('exits 1 when DATABASE_URL is missing', () => {
    const env = { ...VALID_ENV };
    delete env.DATABASE_URL;
    const result = run(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL is missing or empty');
  });

  it('exits 1 when REDIS_URL has an invalid scheme', () => {
    const result = run({
      ...VALID_ENV,
      REDIS_URL: 'http://localhost:6379',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('REDIS_URL format is invalid');
  });

  it('exits 1 when STELLAR_NETWORK_PASSPHRASE is missing', () => {
    const env = { ...VALID_ENV };
    delete env.STELLAR_NETWORK_PASSPHRASE;
    const result = run(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('STELLAR_NETWORK_PASSPHRASE is missing or empty');
  });

  it('exits 1 when PRODUCTION_CORS_ORIGINS is missing', () => {
    const env = { ...VALID_ENV };
    delete env.PRODUCTION_CORS_ORIGINS;
    const result = run(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PRODUCTION_CORS_ORIGINS is missing or empty');
  });

  it('exits 0 with --warn flag even when errors are present', () => {
    const result = run({ ...VALID_ENV, JWT_SECRET: 'short' }, ['--warn']);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('WARNING (non-fatal)');
  });
});
