/**
 * Tests for validate-migration-env.js
 *
 * Runs the script as a child process so that process.exit() calls are isolated
 * to the subprocess and do not terminate the test runner.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'validate-migration-env.js');

function run(env = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
}

describe('validate-migration-env', () => {
  it('exits 0 when DATABASE_URL is a valid SQLite path', () => {
    const result = run({ DATABASE_URL: 'file:./prisma/dev.db' });
    expect(result.status).toBe(0);
  });

  it('exits 0 when DATABASE_URL is a postgresql URL', () => {
    const result = run({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' });
    expect(result.status).toBe(0);
  });

  it('exits 1 when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...envWithout } = process.env;
    const result = spawnSync(process.execPath, [SCRIPT], {
      env: envWithout,
      encoding: 'utf-8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL is not set');
  });

  it('exits 1 when DATABASE_URL has an unrecognised scheme', () => {
    const result = run({ DATABASE_URL: 'ftp://example.com/db' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unrecognised scheme');
  });

  it('exits 0 with --warn flag even when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...envWithout } = process.env;
    const result = spawnSync(process.execPath, [SCRIPT, '--warn'], {
      env: envWithout,
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('WARNING');
  });

  it('exits 1 when REQUIRE_SHADOW_DB=true and SHADOW_DATABASE_URL is absent', () => {
    const { SHADOW_DATABASE_URL: _omit, ...envWithout } = process.env;
    const result = spawnSync(process.execPath, [SCRIPT], {
      env: { ...envWithout, DATABASE_URL: 'file:./dev.db', REQUIRE_SHADOW_DB: 'true' },
      encoding: 'utf-8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SHADOW_DATABASE_URL');
  });
});
