import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import type { MigrationRepository } from '../repositories/migration.repository';
import { createMigrationRepository } from '../repositories/prisma-repositories';

const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');

function getMigrationDirNames(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR).filter((entry) =>
    fs.statSync(path.join(MIGRATIONS_DIR, entry)).isDirectory()
  );
}

async function getAppliedMigrationNames(
  repository: MigrationRepository = createMigrationRepository()
): Promise<Set<string>> {
  return new Set(await repository.findAppliedMigrationNames());
}

/**
 * Verifies that every migration committed under prisma/migrations has been
 * applied to the connected database. In production, a mismatch aborts the
 * boot instead of letting the server serve requests against a stale schema.
 * Pass --skip-migration-check to bypass this (development use only).
 */
export async function checkMigrationsOnStartup(): Promise<void> {
  if (process.argv.includes('--skip-migration-check')) {
    logger.warn('Skipping database migration check (--skip-migration-check flag present).');
    return;
  }

  const migrationDirs = getMigrationDirNames();
  if (migrationDirs.length === 0) {
    return;
  }

  let appliedMigrations: Set<string>;
  try {
    appliedMigrations = await getAppliedMigrationNames();
  } catch (error) {
    logger.error('Migration startup check: failed to read migration history from the database.', error);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    return;
  }

  const pending = migrationDirs.filter((name) => !appliedMigrations.has(name));
  if (pending.length === 0) {
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    logger.error(`Migration startup check: pending database migrations detected: ${pending.join(', ')}. Aborting boot.`);
    process.exit(1);
  }

  logger.warn(`Migration startup check: pending database migrations detected: ${pending.join(', ')}. Continuing because NODE_ENV is not "production".`);
}
