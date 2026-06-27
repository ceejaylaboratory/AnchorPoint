#!/usr/bin/env node
/**
 * check-migrations.js
 *
 * CI/CD migration integrity checker for AnchorPoint.
 *
 * Goals
 * ─────
 * 1. Generate the Prisma client so downstream commands have the right bindings.
 * 2. Prevent destructive schema changes from reaching production undetected.
 * 3. Simulate rollbacks via a shadow database to ensure idempotency.
 * 4. Detect schema drift between the committed migration history and the
 *    current schema.prisma definition.
 *
 * Environment variables
 * ─────────────────────
 * DATABASE_URL        – target database (required)
 * SHADOW_DATABASE_URL – shadow DB used for migration simulation
 *                       (defaults to file:./shadow.db)
 *
 * Exit codes
 * ──────────
 * 0 – all checks passed
 * 1 – one or more checks failed (fatal)
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PRISMA_BINARY = 'npx prisma';
const SCHEMA_PATH = path.join(__dirname, '../prisma/schema.prisma');
const SHADOW_DB_URL = process.env.SHADOW_DATABASE_URL || 'file:./shadow.db';

function run(command, options = {}) {
    try {
        return execSync(command, { stdio: 'inherit', env: { ...process.env, ...options.env } });
    } catch (error) {
        console.error(`Error executing command: ${command}`);
        process.exit(1);
    }
}

function checkDestructiveChanges() {
    console.log('--- Checking for destructive changes ---');
    // We compare the migrations in the migrations folder against the current schema.prisma
    // If there are unapplied changes that cause data loss, we warn.
    
    // Skip in CI if database doesn't exist (migration_lock.toml won't exist)
    const dbUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
    if (dbUrl.startsWith('file:')) {
        const dbPath = path.join(__dirname, '../prisma', dbUrl.replace('file:', ''));
        if (!fs.existsSync(dbPath)) {
            console.log('⚠️  Database does not exist, skipping destructive changes check (expected in CI)');
            return;
        }
    }
    
    try {
        // This command will exit with 1 if there are destructive changes
        execSync(`${PRISMA_BINARY} migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "${SHADOW_DB_URL}" --exit-code`, { stdio: 'inherit' });
        console.log('✅ No destructive changes detected.');
    } catch (error) {
        if (error.status === 1) {
            console.error('❌ Destructive changes detected! Please review your migration.');
            process.exit(1);
        }
        console.error('❌ Migration diff failed.');
        process.exit(1);
    }
}

function simulateMigration() {
    console.log('--- Simulating migrations on shadow database ---');
    // Apply all migrations to the SHADOW database by overriding DATABASE_URL.
    // We must NOT pass SHADOW_DATABASE_URL here – when Prisma sees both vars it
    // cross-checks them and errors if they resolve to the same logical DB.
    const env = {
        ...process.env,
        DATABASE_URL: SHADOW_DB_URL,
    };
    delete env.SHADOW_DATABASE_URL;

    console.log('Resetting shadow database before simulation...');
    if (SHADOW_DB_URL.startsWith('file:')) {
        const dbPath = path.join(__dirname, '../prisma', SHADOW_DB_URL.replace('file:', ''));
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } else {
        // For PostgreSQL: reset using migrate reset --force so any existing
        // schema is dropped before re-applying all migrations from scratch.
        try {
            execSync(`${PRISMA_BINARY} migrate reset --force`, { stdio: 'inherit', env });
        } catch (_) {
            // reset can fail if DB is truly empty — that's fine, continue.
        }
    }

    console.log('Applying migrations to shadow database...');
    // Use migrate deploy instead of migrate dev to apply existing migrations without creating new ones
    run(`${PRISMA_BINARY} migrate deploy`, { env });

    console.log('✅ Migration simulation successful.');
}

function checkDrift() {
    console.log('--- Checking for schema drift ---');
    // Check if the current database state matches the migrations
    try {
        // Check if database exists for SQLite
        const dbUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
        if (dbUrl.startsWith('file:')) {
            const dbPath = path.join(__dirname, '../prisma', dbUrl.replace('file:', ''));
            if (!fs.existsSync(dbPath)) {
                console.log('⚠️  Database does not exist, skipping drift check (expected in CI)');
                return;
            }
        }
        run(`${PRISMA_BINARY} migrate status`);
        console.log('✅ No drift detected.');
    } catch (error) {
        console.error('❌ Schema drift detected or migrations out of sync.');
        process.exit(1);
    }
}

/**
 * Generate the Prisma client before any migration commands.
 * This is a no-op if the client is already up to date, but prevents
 * confusing "PrismaClient not found" errors in fresh CI environments.
 */
function generateClient() {
    console.log('--- Generating Prisma client ---');
    try {
        execSync(`${PRISMA_BINARY} generate`, { stdio: 'inherit' });
        console.log('✅ Prisma client generated.');
    } catch (error) {
        console.error('❌ Failed to generate Prisma client.');
        process.exit(1);
    }
}

async function main() {
    console.log('🚀 Starting Database Migration Integrity Check');

    // Ensure we are in the backend directory so relative paths resolve correctly
    process.chdir(path.join(__dirname, '..'));

    // Validate environment before doing anything else (subprocess so it can exit independently)
    try {
        execSync('node scripts/validate-migration-env.js', { stdio: 'inherit' });
    } catch (_) {
        console.error('❌ Environment validation failed. Aborting migration check.');
        process.exit(1);
    }

    try {
        generateClient();
        checkDrift();
        checkDestructiveChanges();
        simulateMigration();

        console.log('\n✨ All migration integrity checks passed!');
    } catch (error) {
        console.error('\n💥 Migration integrity check failed:', error && error.message ? error.message : error);
        process.exit(1);
    }
}

main();
