#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { PrismaClient } from '@prisma/client';
import RollbackGenerator from './generate-rollback';

/**
 * Rollback Verification Script
 *
 * Checks foreign key integrity BEFORE applying a rollback SQL file.
 * Usage:
 *   ts-node scripts/rollback.ts [migration_name] [--force] [--dry-run]
 *
 * Options:
 *   migration_name  Target migration directory name (defaults to latest)
 *   --force         Skip confirmation prompt and apply even with FK violations
 *   --dry-run       Report FK check results without applying the rollback
 */

interface FKViolation {
  referencingTable: string;
  referencingColumn: string;
  referencedTable: string;
  referencedColumn: string;
  affectedRowCount: number;
}

interface FKRow {
  table: string;
  from: string;
  referencedTable: string;
  to: string;
}

interface CountRow {
  count: number;
}

class RollbackVerifier {
  private prisma: PrismaClient;
  private migrationsDir: string;

  constructor() {
    this.prisma = new PrismaClient();
    this.migrationsDir = path.join(__dirname, '../prisma/migrations');
  }

  async run(migrationName?: string, force = false, dryRun = false): Promise<void> {
    console.log('🔍 Migration Rollback Verifier\n' + '='.repeat(60));

    try {
      // 1. Resolve migration and locate/generate rollback.sql
      const resolvedMigration = this.resolveMigration(migrationName);
      if (!resolvedMigration) {
        console.error('❌ No migrations found.');
        process.exit(1);
      }

      console.log(`\n📁 Target migration: ${resolvedMigration}`);
      const rollbackSqlPath = await this.ensureRollbackSql(resolvedMigration);

      const rollbackSql = fs.readFileSync(rollbackSqlPath, 'utf-8');
      console.log(`📄 Rollback SQL: ${rollbackSqlPath}`);

      // 2. Parse which tables will be dropped/altered by the rollback
      const droppedTables = this.extractDroppedTables(rollbackSql);
      if (droppedTables.length > 0) {
        console.log(`\n🗑  Tables to be dropped: ${droppedTables.join(', ')}`);
      }

      // 3. Check FK integrity
      console.log('\n🔎 Checking foreign key integrity...');
      const violations = await this.checkForeignKeyViolations(droppedTables);
      const existingViolations = await this.checkExistingFKViolations();

      this.printIntegrityReport(violations, existingViolations, droppedTables);

      const hasBlockingViolations = violations.some(v => v.affectedRowCount > 0);

      if (dryRun) {
        console.log('\n🧪 Dry-run mode — rollback SQL was NOT applied.');
        process.exit(hasBlockingViolations ? 1 : 0);
      }

      // 4. Confirm before applying
      if (hasBlockingViolations && !force) {
        console.log('\n❌ FK violations detected. Use --force to apply anyway (may break referential integrity).');
        process.exit(1);
      }

      if (!force) {
        const confirmed = await this.confirm(
          `\n⚠️  Apply rollback for migration "${resolvedMigration}"? [y/N] `
        );
        if (!confirmed) {
          console.log('Aborted.');
          process.exit(0);
        }
      } else {
        console.log('\n⚡ --force flag set — skipping confirmation prompt.');
      }

      // 5. Apply rollback SQL
      await this.applyRollback(rollbackSql, droppedTables);
      console.log('\n✅ Rollback applied successfully.');
    } finally {
      await this.prisma.$disconnect();
    }
  }

  /**
   * Resolve the target migration name (latest if not specified).
   */
  private resolveMigration(name?: string): string | null {
    if (!fs.existsSync(this.migrationsDir)) return null;

    const migrations = fs
      .readdirSync(this.migrationsDir)
      .filter(f => {
        const full = path.join(this.migrationsDir, f);
        return fs.statSync(full).isDirectory() && f !== 'migration_lock.toml';
      })
      .sort();

    if (migrations.length === 0) return null;

    if (name) {
      if (!migrations.includes(name)) {
        console.error(`❌ Migration not found: ${name}`);
        console.error(`   Available: ${migrations.slice(-5).join(', ')}`);
        process.exit(1);
      }
      return name;
    }

    return migrations[migrations.length - 1];
  }

  /**
   * Ensure rollback.sql exists for the target migration, generating it if missing.
   */
  private async ensureRollbackSql(migrationName: string): Promise<string> {
    const migrationPath = path.join(this.migrationsDir, migrationName);
    const rollbackPath = path.join(migrationPath, 'rollback.sql');

    if (!fs.existsSync(rollbackPath)) {
      console.log('⚙️  rollback.sql not found — generating it now...');
      const generator = new RollbackGenerator();
      generator.generateRollback(migrationName);

      if (!fs.existsSync(rollbackPath)) {
        console.error('❌ Failed to generate rollback.sql');
        process.exit(1);
      }
    }

    return rollbackPath;
  }

  /**
   * Extract table names that will be dropped by the rollback SQL.
   */
  private extractDroppedTables(sql: string): string[] {
    const dropped = new Set<string>();
    const pattern = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(sql)) !== null) {
      dropped.add(m[1]);
    }
    return Array.from(dropped);
  }

  /**
   * Check which FK references would break if the given tables are dropped.
   * Returns violations grouped by (referencingTable, referencedTable).
   */
  private async checkForeignKeyViolations(droppedTables: string[]): Promise<FKViolation[]> {
    if (droppedTables.length === 0) return [];

    const violations: FKViolation[] = [];

    for (const fk of await this.getForeignKeys()) {
      if (!droppedTables.includes(fk.referencedTable)) continue;
      // The referencing table is dropped too (before its parent), so nothing is orphaned.
      if (droppedTables.includes(fk.table)) continue;

      // Count rows in this table that reference the to-be-dropped table
      const countResult = await this.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS count FROM "${fk.table}" WHERE "${fk.from}" IS NOT NULL`
      );
      const affectedRowCount = Number(countResult[0]?.count ?? 0);

      violations.push({
        referencingTable: fk.table,
        referencingColumn: fk.from,
        referencedTable: fk.referencedTable,
        referencedColumn: fk.to ?? 'id',
        affectedRowCount,
      });
    }

    return violations;
  }

  /**
   * List every foreign key in the current Postgres schema.
   */
  private async getForeignKeys(): Promise<FKRow[]> {
    return this.prisma.$queryRawUnsafe<FKRow[]>(
      `SELECT tc.table_name::text AS "table", kcu.column_name::text AS "from",
              ccu.table_name::text AS "referencedTable", ccu.column_name::text AS "to"
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()`
    );
  }

  /**
   * Order tables so that children (referencing tables) are dropped before
   * the parents they reference (reverse topological order).
   */
  private orderTablesForDrop(tables: string[], fks: FKRow[]): string[] {
    const remaining = new Set(tables);
    const ordered: string[] = [];

    while (remaining.size > 0) {
      // A table can be dropped once no other remaining table references it.
      const next = Array.from(remaining).filter(
        t => !fks.some(fk => fk.referencedTable === t && fk.table !== t && remaining.has(fk.table))
      );
      // Cycle: fall back to the remaining tables as-is.
      const batch = next.length > 0 ? next : Array.from(remaining);
      batch.forEach(t => {
        ordered.push(t);
        remaining.delete(t);
      });
    }

    return ordered;
  }

  /**
   * Check for FK violations already present in the database (pre-rollback state).
   */
  private async checkExistingFKViolations(): Promise<string[]> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `PRAGMA foreign_key_check`
      );
      return rows.map(r => `${r['table']}(rowid=${r['rowid']}): FK → ${r['parent']}`);
    } catch {
      return [];
    }
  }

  /**
   * Print the FK integrity report.
   */
  private printIntegrityReport(
    violations: FKViolation[],
    existingViolations: string[],
    droppedTables: string[]
  ): void {
    console.log('\n' + '='.repeat(60));
    console.log('  Foreign Key Integrity Report');
    console.log('='.repeat(60));

    if (existingViolations.length > 0) {
      console.log(`\n⚠️  Pre-existing FK violations in database (${existingViolations.length}):`);
      existingViolations.forEach(v => console.log(`   • ${v}`));
    } else {
      console.log('\n✅ No pre-existing FK violations in current database state.');
    }

    if (droppedTables.length === 0) {
      console.log('\n✅ No DROP TABLE statements in rollback — no FK impact analysis needed.');
      console.log('='.repeat(60) + '\n');
      return;
    }

    const blocking = violations.filter(v => v.affectedRowCount > 0);
    const safe = violations.filter(v => v.affectedRowCount === 0);

    if (safe.length > 0) {
      console.log(`\n✅ Safe FK references (0 referencing rows, no impact):`);
      safe.forEach(v =>
        console.log(
          `   • ${v.referencingTable}.${v.referencingColumn} → ${v.referencedTable}.${v.referencedColumn}`
        )
      );
    }

    if (blocking.length > 0) {
      console.log(`\n❌ FK violations that WILL occur after rollback (${blocking.length}):`);
      blocking.forEach(v =>
        console.log(
          `   • ${v.referencingTable}.${v.referencingColumn} → ${v.referencedTable}.${v.referencedColumn}` +
            ` (${v.affectedRowCount} referencing row${v.affectedRowCount !== 1 ? 's' : ''})`
        )
      );
      console.log('\n   ⚠️  These rows will have dangling foreign key references after the rollback.');
      console.log('   ⚠️  Consider cleaning up referencing rows before rolling back,');
      console.log('       or use --force to apply anyway (NOT recommended for production).');
    } else if (violations.length > 0) {
      console.log('\n✅ All FK references are safe — no rows would be orphaned.');
    }

    console.log('='.repeat(60) + '\n');
  }

  /**
   * Apply rollback SQL statements one by one.
   */
  private async applyRollback(sql: string, droppedTables: string[]): Promise<void> {
    console.log('\n🚀 Applying rollback SQL...');

    const statements = sql
      .split(';')
      .map(s => s.trim())
      // Strip comment lines (generated rollback.sql prefixes every statement
      // with comments) and skip pure-comment blocks
      .map(stmt =>
        stmt
          .split('\n')
          .filter(l => !l.trim().startsWith('--'))
          .join('\n')
          .trim()
      )
      .filter(stmt => stmt.length > 0);

    // Re-order the DROP TABLE statements (in place, keeping their slots) so
    // children are dropped before their parents.
    if (droppedTables.length > 1) {
      const dropOrder = this.orderTablesForDrop(droppedTables, await this.getForeignKeys());
      const dropSlots = statements
        .map((stmt, i) => (this.extractDroppedTables(stmt).length > 0 ? i : -1))
        .filter(i => i >= 0);
      const dropStatements = dropSlots
        .map(i => statements[i])
        .sort(
          (a, b) =>
            dropOrder.indexOf(this.extractDroppedTables(a)[0]) -
            dropOrder.indexOf(this.extractDroppedTables(b)[0])
        );
      dropSlots.forEach((slot, i) => {
        statements[slot] = dropStatements[i];
      });
    }

    let applied = 0;
    // Run everything in one transaction so a failure leaves the schema untouched.
    // Deferrable constraints are only checked at commit.
    await this.prisma.$transaction(
      async tx => {
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
        for (const stmt of statements) {
          try {
            await tx.$executeRawUnsafe(stmt);
            applied++;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`\n❌ Failed to execute statement:\n   ${stmt}\n   Error: ${msg}`);
            throw err;
          }
        }
      },
      { timeout: 120000 }
    );

    console.log(`   Applied ${applied} statement${applied !== 1 ? 's' : ''}.`);
  }

  /**
   * Prompt the user for a yes/no confirmation.
   */
  private confirm(prompt: string): Promise<boolean> {
    return new Promise(resolve => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(prompt, answer => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const migrationName = args.find(a => !a.startsWith('--'));

  const verifier = new RollbackVerifier();
  verifier.run(migrationName, force, dryRun).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export default RollbackVerifier;
