#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_DATABASE_URL = 'file:./prisma/dev.db';

function parseArgs(argv) {
  const args = {
    source: undefined,
    databaseUrl: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
    backupDir: path.join(os.tmpdir(), 'anchorpoint-db-restore'),
    restoreTarget: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--source') {
      args.source = requireValue(arg, next);
      index += 1;
    } else if (arg === '--database-url') {
      args.databaseUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === '--backup-dir') {
      args.backupDir = requireValue(arg, next);
      index += 1;
    } else if (arg === '--restore-target') {
      args.restoreTarget = requireValue(arg, next);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(arg, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`${arg} requires a value`);
  }

  return value;
}

function printHelp() {
  console.log(`
Verify that an AnchorPoint SQLite database can be backed up and restored.

Usage:
  npm run db:restore:verify
  npm run db:restore:verify -- --source ./prisma/dev.db
  npm run db:restore:verify -- --database-url file:./prisma/dev.db --backup-dir /tmp/anchorpoint-dr

Options:
  --source <path>         SQLite database file to verify. Overrides DATABASE_URL.
  --database-url <url>    Prisma SQLite DATABASE_URL. Only file: URLs are supported.
  --backup-dir <path>     Directory for generated backup and restore probe files.
  --restore-target <path> Optional explicit restore target path.
`);
}

function resolveDatabasePath(args) {
  if (args.source) {
    return path.resolve(process.cwd(), args.source);
  }

  const databaseUrl = args.databaseUrl;
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('Only SQLite file: DATABASE_URL values are supported by this restore verifier');
  }

  const rawPath = databaseUrl.slice('file:'.length);
  if (!rawPath) {
    throw new Error('DATABASE_URL file path is empty');
  }

  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

function ensureSqliteAvailable() {
  try {
    execFileSync('sqlite3', ['--version'], { stdio: 'pipe' });
  } catch (error) {
    throw new Error('sqlite3 CLI is required to run restore verification');
  }
}

function runSqlite(dbPath, sql) {
  return execFileSync('sqlite3', [dbPath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteDotCommandPath(filePath) {
  return `'${filePath.replace(/'/g, "''")}'`;
}

function quickCheck(dbPath) {
  const result = runSqlite(dbPath, 'PRAGMA quick_check;');
  if (result !== 'ok') {
    throw new Error(`SQLite quick_check failed for ${dbPath}: ${result}`);
  }
}

function listTables(dbPath) {
  const output = runSqlite(
    dbPath,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
  );

  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function tableCounts(dbPath, tables) {
  return tables.map((table) => {
    const count = runSqlite(dbPath, `SELECT COUNT(*) FROM ${quoteIdentifier(table)};`);
    return { table, count: Number(count) };
  });
}

function assertMatchingCounts(sourceCounts, restoredCounts) {
  const sourceByTable = new Map(sourceCounts.map((entry) => [entry.table, entry.count]));
  const restoredByTable = new Map(restoredCounts.map((entry) => [entry.table, entry.count]));

  for (const table of sourceByTable.keys()) {
    if (!restoredByTable.has(table)) {
      throw new Error(`Restored database is missing table ${table}`);
    }

    if (sourceByTable.get(table) !== restoredByTable.get(table)) {
      throw new Error(
        `Row count mismatch for ${table}: source=${sourceByTable.get(table)} restored=${restoredByTable.get(table)}`
      );
    }
  }

  for (const table of restoredByTable.keys()) {
    if (!sourceByTable.has(table)) {
      throw new Error(`Restored database has unexpected table ${table}`);
    }
  }
}

function createBackup(sourcePath, backupPath) {
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }

  runSqlite(sourcePath, `.backup ${quoteDotCommandPath(backupPath)}`);
}

function copyBackupToRestoreTarget(backupPath, restoreTarget) {
  fs.mkdirSync(path.dirname(restoreTarget), { recursive: true });
  if (fs.existsSync(restoreTarget)) {
    fs.unlinkSync(restoreTarget);
  }

  fs.copyFileSync(backupPath, restoreTarget);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourcePath = resolveDatabasePath(args);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Database file does not exist: ${sourcePath}`);
  }

  ensureSqliteAvailable();

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const backupPath = path.resolve(args.backupDir, `anchorpoint-${timestamp}.backup.db`);
  const restoreTarget = args.restoreTarget
    ? path.resolve(process.cwd(), args.restoreTarget)
    : path.resolve(args.backupDir, `anchorpoint-${timestamp}.restore-check.db`);

  quickCheck(sourcePath);
  const sourceTables = listTables(sourcePath);
  const sourceCounts = tableCounts(sourcePath, sourceTables);

  createBackup(sourcePath, backupPath);
  quickCheck(backupPath);

  copyBackupToRestoreTarget(backupPath, restoreTarget);
  quickCheck(restoreTarget);

  const restoredTables = listTables(restoreTarget);
  const restoredCounts = tableCounts(restoreTarget, restoredTables);
  assertMatchingCounts(sourceCounts, restoredCounts);

  const totalRows = sourceCounts.reduce((sum, entry) => sum + entry.count, 0);

  console.log('AnchorPoint DB restore verification passed');
  console.log(`Source: ${sourcePath}`);
  console.log(`Backup: ${backupPath}`);
  console.log(`Restore probe: ${restoreTarget}`);
  console.log(`Tables verified: ${sourceTables.length}`);
  console.log(`Rows verified: ${totalRows}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`AnchorPoint DB restore verification failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  resolveDatabasePath,
  quoteIdentifier,
  listTables,
  tableCounts,
  assertMatchingCounts,
};
