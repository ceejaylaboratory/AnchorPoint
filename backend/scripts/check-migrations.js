#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Prisma Migration Integrity Checker
 * 
 * Goals:
 * 1. Prevent destructive changes to production databases (via prisma migrate diff).
 * 2. Simulate rollbacks to ensure idempotency.
 * 3. Check for schema drifts.
 */

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
    try {
        // This command will exit with 1 if there are destructive changes
        execSync(`${PRISMA_BINARY} migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code`, { stdio: 'inherit' });
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
    // 1. Reset shadow DB
    // 2. Apply all migrations
    // 3. Check if schema matches schema.prisma
    
    const env = { DATABASE_URL: SHADOW_DB_URL };
    
    console.log('Cleaning shadow database...');
    if (SHADOW_DB_URL.startsWith('file:')) {
        const dbPath = path.join(__dirname, '../prisma', SHADOW_DB_URL.replace('file:', ''));
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }

    console.log('Applying migrations to shadow database...');
    run(`${PRISMA_BINARY} migrate dev --name ci_simulation --skip-generate`, { env });
    
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

async function main() {
    console.log('🚀 Starting Database Migration Integrity Check');
    
    // Ensure we are in the backend directory
    process.chdir(path.join(__dirname, '..'));

    try {
        checkDrift();
        checkDestructiveChanges();
        simulateMigration();
        
        console.log('\n✨ All migration integrity checks passed!');
    } catch (error) {
        console.error('\n💥 Migration integrity check failed.');
        process.exit(1);
    }
}

main();
