#!/usr/bin/env node
/**
 * validate-env.js
 *
 * Pre-deployment CLI validator script verifying mandatory production environment
 * variables are present and formatted correctly before deploying AnchorPoint containers.
 *
 * Validates:
 *   - JWT_SECRET (must be >= 32 characters)
 *   - DATABASE_URL (must be valid database connection string)
 *   - REDIS_URL (must be valid redis/rediss URL)
 *   - STELLAR_NETWORK_PASSPHRASE (must be present and non-empty)
 *   - PRODUCTION_CORS_ORIGINS (must be present and non-empty)
 *
 * Usage:
 *   node tools/validate-env.js
 *   node tools/validate-env.js --warn
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Helper to parse env file manually if process.env values are not set
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key] && value) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    // Ignore read errors
  }
}

// Attempt to load .env or .env.production if running locally or pre-build
const rootDir = path.resolve(__dirname, '..');
loadEnvFile(path.join(rootDir, '.env.production'));
loadEnvFile(path.join(rootDir, '.env'));
loadEnvFile(path.join(rootDir, 'backend', '.env'));

const warnOnly = process.argv.includes('--warn');

const errors = [];
const warnings = [];
const validatedKeys = [];

// 1. JWT_SECRET
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  errors.push('JWT_SECRET is missing or empty.');
} else if (jwtSecret.length < 32) {
  errors.push(`JWT_SECRET must be at least 32 characters long for production security (current length: ${jwtSecret.length}).`);
} else if (['stellar-anchor-secret', 'your-secret-key-min-8-chars', 'secret'].includes(jwtSecret)) {
  errors.push('JWT_SECRET is set to an insecure default placeholder value.');
} else {
  validatedKeys.push({ key: 'JWT_SECRET', detail: `Valid secret (${jwtSecret.length} chars)` });
}

// 2. DATABASE_URL
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  errors.push('DATABASE_URL is missing or empty.');
} else if (!/^(postgresql:|postgres:|mysql:|sqlite:|file:|mongodb\+srv:)/i.test(dbUrl)) {
  errors.push(`DATABASE_URL format is invalid or has unrecognized scheme: "${dbUrl.split(':')[0]}"`);
} else {
  validatedKeys.push({ key: 'DATABASE_URL', detail: `Valid scheme (${dbUrl.split(':')[0]}:)` });
}

// 3. REDIS_URL
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  errors.push('REDIS_URL is missing or empty.');
} else if (!/^(redis:|rediss:)/i.test(redisUrl)) {
  errors.push(`REDIS_URL format is invalid. Must start with redis:// or rediss:// (got: "${redisUrl.split(':')[0]}")`);
} else {
  validatedKeys.push({ key: 'REDIS_URL', detail: `Valid Redis URL (${redisUrl.split(':')[0]}//)` });
}

// 4. STELLAR_NETWORK_PASSPHRASE
const stellarPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE;
if (!stellarPassphrase || stellarPassphrase.trim().length === 0) {
  errors.push('STELLAR_NETWORK_PASSPHRASE is missing or empty.');
} else {
  validatedKeys.push({ key: 'STELLAR_NETWORK_PASSPHRASE', detail: `Configured ("${stellarPassphrase.trim()}")` });
}

// 5. PRODUCTION_CORS_ORIGINS
const corsOrigins = process.env.PRODUCTION_CORS_ORIGINS;
if (!corsOrigins || corsOrigins.trim().length === 0) {
  errors.push('PRODUCTION_CORS_ORIGINS is missing or empty.');
} else if (corsOrigins.trim() === '*' && process.env.NODE_ENV === 'production') {
  warnings.push('PRODUCTION_CORS_ORIGINS is set to wildcard "*" in production.');
  validatedKeys.push({ key: 'PRODUCTION_CORS_ORIGINS', detail: `Set to "${corsOrigins.trim()}" (wildcard warning)` });
} else {
  validatedKeys.push({ key: 'PRODUCTION_CORS_ORIGINS', detail: `Configured ("${corsOrigins.trim()}")` });
}

// Output Results
console.log('\n==================================================');
console.log('  AnchorPoint Pre-Deployment Environment Validator');
console.log('==================================================\n');

if (validatedKeys.length > 0) {
  console.log('PASSED CHECKS:');
  validatedKeys.forEach(({ key, detail }) => {
    console.log(`  ✓ ${key.padEnd(30)} : ${detail}`);
  });
  console.log('');
}

if (warnings.length > 0) {
  console.warn('WARNINGS:');
  warnings.forEach((warn) => {
    console.warn(`  ⚠️  ${warn}`);
  });
  console.log('');
}

if (errors.length > 0) {
  const label = warnOnly ? '⚠️  WARNING (non-fatal)' : '❌  VALIDATION FAILED';
  console.error(`${label}: Missing or invalid mandatory environment variables:\n`);
  errors.forEach((err) => {
    console.error(`  • ${err}`);
  });
  console.error('\nDeployment aborted. Please configure missing variables in environment.\n');

  if (!warnOnly) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

console.log('✅  Environment validation succeeded! All mandatory variables are present and valid.\n');
process.exit(0);
