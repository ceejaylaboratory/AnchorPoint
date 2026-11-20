#!/usr/bin/env node
/**
 * Local self-test for scripts/smoke-test.sh.
 * Spins up a mock HTTP server, asserts exit code 0 on success and 1 on failure.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'smoke-test.sh');
const ACCOUNT = 'GB7KUA47QKRI6Q6X7C3HOC2HEP6VJQRQWQYQF66VJPHJRVMEDJOVML6K';

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function runSmoke({ env, extraEnv = {} }) {
  return new Promise((resolve) => {
    const child = spawn('bash', [SCRIPT], {
      env: { ...process.env, ...env, ...extraEnv },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function healthyHandler(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const okPaths = new Set([
    '/health',
    '/.well-known/stellar.toml',
    '/auth',
    '/info',
    '/sep10',
    '/sep24/info',
    '/sep38/info',
  ]);
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'UP' }));
    return;
  }
  if (url.pathname === '/.well-known/stellar.toml') {
    res.writeHead(200, { 'Content-Type': 'text/toml' });
    res.end(`version = "1.0.0"\nsigning_key = "${ACCOUNT}"\n`);
    return;
  }
  if (url.pathname === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      signing_key: ACCOUNT,
      assets: [{ code: 'USDC', status: 'live' }],
      fee_variations: { deposit: { USDC: { min_amount: '1' } }, withdraw: { USDC: { min_amount: '1' } } },
    }));
    return;
  }
  if (okPaths.has(url.pathname)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
}

function failingHandler(_req, res) {
  res.writeHead(503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'DOWN' }));
}

async function main() {
  const missing = await runSmoke({ env: { TARGET_HOST: '', BASE_URL: '' } });
  if (missing.code !== 1) {
    throw new Error(`expected exit 1 when TARGET_HOST is missing, got ${missing.code}\n${missing.stderr}`);
  }

  const { server: healthyServer, port: healthyPort } = await startServer(healthyHandler);
  try {
    const healthy = await runSmoke({
      env: {
        TARGET_HOST: `http://127.0.0.1:${healthyPort}`,
        SMOKE_TEST_ACCOUNT: ACCOUNT,
        SMOKE_TEST_CONNECT_TIMEOUT: '2',
        SMOKE_TEST_MAX_TIME: '5',
      },
    });
    if (healthy.code !== 0) {
      throw new Error(`expected exit 0 against healthy mock, got ${healthy.code}\n${healthy.stdout}\n${healthy.stderr}`);
    }
    if (!healthy.stdout.includes('GET /.well-known/stellar.toml')) {
      throw new Error('healthy run did not probe GET /.well-known/stellar.toml');
    }
    if (!healthy.stdout.includes('GET /auth')) {
      throw new Error('healthy run did not probe GET /auth');
    }
    if (!healthy.stdout.includes('GET /info')) {
      throw new Error('healthy run did not probe GET /info');
    }
    if (!healthy.stdout.includes('has a valid SIGNING_KEY')) {
      throw new Error('healthy run did not validate the stellar.toml SIGNING_KEY');
    }
  } finally {
    healthyServer.close();
  }

  const { server: failingServer, port: failingPort } = await startServer(failingHandler);
  try {
    const failing = await runSmoke({
      env: {
        TARGET_HOST: `http://127.0.0.1:${failingPort}`,
        SMOKE_TEST_ACCOUNT: ACCOUNT,
        SMOKE_TEST_CONNECT_TIMEOUT: '2',
        SMOKE_TEST_MAX_TIME: '5',
      },
    });
    if (failing.code !== 1) {
      throw new Error(`expected exit 1 against failing mock, got ${failing.code}\n${failing.stdout}\n${failing.stderr}`);
    }
  } finally {
    failingServer.close();
  }

  console.log('smoke-test.selftest: all checks passed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
