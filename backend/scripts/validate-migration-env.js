#!/usr/bin/env node
/**
 * validate-migration-env.js
 *
 * Validates that all required environment variables are present and well-formed
 * before any Prisma migration command runs.  Failing fast here prevents
 * confusing Prisma errors that surface far from the actual root cause.
 *
 * Usage:
 *   node scripts/validate-migration-env.js           # exits 1 on failure
 *   node scripts/validate-migration-env.js --warn    # exits 0 but prints warnings
 */

'use strict';

const warnOnly = process.argv.includes('--warn');

const issues = [];

// ── Required ─────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  issues.push('DATABASE_URL is not set');
} else if (!/^(file:|postgresql:|postgres:|mysql:|sqlserver:|mongodb\+srv:)/.test(DATABASE_URL)) {
  issues.push(`DATABASE_URL has an unrecognised scheme: "${DATABASE_URL.split(':')[0]}:"`);
}

// ── SQLite-specific checks ────────────────────────────────────────────────────

if (DATABASE_URL && DATABASE_URL.startsWith('file:')) {
  const path = require('path');
  const fs   = require('fs');

  // Resolve the DB file relative to the backend root (one level up from scripts/)
  const backendRoot = path.resolve(__dirname, '..');
  const dbRelative  = DATABASE_URL.replace(/^file:/, '');
  const dbAbsolute  = path.isAbsolute(dbRelative)
    ? dbRelative
    : path.join(backendRoot, dbRelative);

  const dbDir = path.dirname(dbAbsolute);
  if (!fs.existsSync(dbDir)) {
    issues.push(`DATABASE_URL directory does not exist: ${dbDir}`);
  }
}

// ── Shadow DB (required for migrate dev; optional for deploy / CI) ────────────

const SHADOW_DATABASE_URL = process.env.SHADOW_DATABASE_URL;
if (process.env.REQUIRE_SHADOW_DB === 'true' && !SHADOW_DATABASE_URL) {
  issues.push('SHADOW_DATABASE_URL is required when REQUIRE_SHADOW_DB=true');
}

// ── Report ────────────────────────────────────────────────────────────────────

if (issues.length === 0) {
  console.log('✅  Migration environment validation passed');
  console.log(`    DATABASE_URL scheme : ${(DATABASE_URL || '').split(':')[0]}:`);
  if (SHADOW_DATABASE_URL) {
    console.log(`    SHADOW_DATABASE_URL : set`);
  }
  process.exit(0);
}

const label = warnOnly ? '⚠️  WARNING' : '❌  ERROR';
console.error(`\n${label}: Migration environment validation failed\n`);
issues.forEach(i => console.error(`  • ${i}`));
console.error('');

if (warnOnly) {
  process.exit(0);
} else {
  process.exit(1);
}
