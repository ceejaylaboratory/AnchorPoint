#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate rollback scripts for Prisma migrations
 * 
 * Since Prisma doesn't have built-in rollback support,
 * this tool helps generate reverse migration scripts
 */

interface RollbackOperation {
  original: string;
  rollback: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

class RollbackGenerator {
  private migrationsDir: string;

  constructor() {
    this.migrationsDir = path.join(__dirname, '../prisma/migrations');
  }

  /**
   * Generate rollback script for the latest migration
   */
  generateRollback(migrationName?: string): void {
    const migrations = this.getAllMigrations();
    
    if (migrations.length === 0) {
      console.log('No migrations found.');
      return;
    }

    const targetMigration = migrationName || migrations[migrations.length - 1];
    const migrationPath = path.join(this.migrationsDir, targetMigration);
    const sqlPath = path.join(migrationPath, 'migration.sql');

    if (!fs.existsSync(sqlPath)) {
      console.error(`Migration SQL file not found: ${sqlPath}`);
      return;
    }

    const sql = fs.readFileSync(sqlPath, 'utf-8');
    const operations = this.parseSQL(sql);
    const rollbackOps = operations.map(op => this.generateRollbackOperation(op));

    this.writeRollbackScript(migrationPath, rollbackOps);
    this.printSummary(targetMigration, rollbackOps);
  }

  /**
   * Parse SQL into individual operations
   */
  private parseSQL(sql: string): string[] {
    // Split by semicolons, but keep the statement structure
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    return statements;
  }

  /**
   * Generate rollback operation for a SQL statement
   */
  private generateRollbackOperation(statement: string): RollbackOperation {
    const upperStatement = statement.toUpperCase();

    // CREATE TABLE -> DROP TABLE
    if (upperStatement.includes('CREATE TABLE')) {
      const tableName = this.extractTableName(statement, 'CREATE TABLE');
      return {
        original: statement,
        rollback: `DROP TABLE IF EXISTS "${tableName}";`,
        confidence: 'high',
      };
    }

    // DROP TABLE -> Cannot rollback (data loss)
    if (upperStatement.includes('DROP TABLE')) {
      const tableName = this.extractTableName(statement, 'DROP TABLE');
      return {
        original: statement,
        rollback: `-- MANUAL ROLLBACK REQUIRED: Restore table "${tableName}" from backup`,
        confidence: 'low',
        notes: 'Data loss occurred. Restore from backup.',
      };
    }

    // ALTER TABLE ADD COLUMN -> ALTER TABLE DROP COLUMN
    if (upperStatement.includes('ALTER TABLE') && upperStatement.includes('ADD COLUMN')) {
      const tableName = this.extractTableName(statement, 'ALTER TABLE');
      const columnName = this.extractColumnName(statement, 'ADD COLUMN');
      return {
        original: statement,
        rollback: `ALTER TABLE "${tableName}" DROP COLUMN "${columnName}";`,
        confidence: 'high',
      };
    }

    // ALTER TABLE DROP COLUMN -> Cannot rollback (data loss)
    if (upperStatement.includes('ALTER TABLE') && upperStatement.includes('DROP COLUMN')) {
      const tableName = this.extractTableName(statement, 'ALTER TABLE');
      const columnName = this.extractColumnName(statement, 'DROP COLUMN');
      return {
        original: statement,
        rollback: `-- MANUAL ROLLBACK REQUIRED: Restore column "${columnName}" in table "${tableName}" from backup`,
        confidence: 'low',
        notes: 'Data loss occurred. Restore from backup.',
      };
    }

    // CREATE INDEX -> DROP INDEX
    if (upperStatement.includes('CREATE INDEX') || upperStatement.includes('CREATE UNIQUE INDEX')) {
      const indexName = this.extractIndexName(statement);
      return {
        original: statement,
        rollback: `DROP INDEX IF EXISTS "${indexName}";`,
        confidence: 'high',
      };
    }

    // DROP INDEX -> Recreate index
    if (upperStatement.includes('DROP INDEX')) {
      const indexName = this.extractIndexName(statement);
      return {
        original: statement,
        rollback: `-- MANUAL ROLLBACK REQUIRED: Recreate index "${indexName}"`,
        confidence: 'medium',
        notes: 'Index definition needed from previous migration.',
      };
    }

    // INSERT -> DELETE
    if (upperStatement.includes('INSERT INTO')) {
      const tableName = this.extractTableName(statement, 'INSERT INTO');
      return {
        original: statement,
        rollback: `-- MANUAL ROLLBACK REQUIRED: Delete inserted rows from "${tableName}"`,
        confidence: 'medium',
        notes: 'Identify and delete specific rows.',
      };
    }

    // DELETE -> Cannot rollback
    if (upperStatement.includes('DELETE FROM')) {
      const tableName = this.extractTableName(statement, 'DELETE FROM');
      return {
        original: statement,
        rollback: `-- MANUAL ROLLBACK REQUIRED: Restore deleted rows in "${tableName}" from backup`,
        confidence: 'low',
        notes: 'Data loss occurred. Restore from backup.',
      };
    }

    // UPDATE -> Cannot automatically rollback
    if (upperStatement.includes('UPDATE')) {
      const tableName = this.extractTableName(statement, 'UPDATE');
      return {
        original: statement,
        rollback: `-- MANUAL ROLLBACK REQUIRED: Restore previous values in "${tableName}" from backup`,
        confidence: 'low',
        notes: 'Previous values needed from backup.',
      };
    }

    // Default: Unknown operation
    return {
      original: statement,
      rollback: `-- MANUAL ROLLBACK REQUIRED: Review and create rollback for this operation`,
      confidence: 'low',
      notes: 'Unknown operation type.',
    };
  }

  /**
   * Extract table name from SQL statement
   */
  private extractTableName(statement: string, keyword: string): string {
    const regex = new RegExp(`${keyword}\\s+["']?(\\w+)["']?`, 'i');
    const match = statement.match(regex);
    return match ? match[1] : 'UNKNOWN_TABLE';
  }

  /**
   * Extract column name from SQL statement
   */
  private extractColumnName(statement: string, keyword: string): string {
    const regex = new RegExp(`${keyword}\\s+["']?(\\w+)["']?`, 'i');
    const match = statement.match(regex);
    return match ? match[1] : 'UNKNOWN_COLUMN';
  }

  /**
   * Extract index name from SQL statement
   */
  private extractIndexName(statement: string): string {
    const regex = /(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+["']?(\w+)["']?/i;
    const match = statement.match(regex);
    return match ? match[1] : 'UNKNOWN_INDEX';
  }

  /**
   * Write rollback script to file
   */
  private writeRollbackScript(migrationPath: string, operations: RollbackOperation[]): void {
    const rollbackPath = path.join(migrationPath, 'rollback.sql');
    
    let content = '-- ROLLBACK SCRIPT\n';
    content += '-- Generated automatically - REVIEW BEFORE EXECUTING\n';
    content += '-- Execute these statements in reverse order to rollback the migration\n\n';

    // Reverse the order for rollback
    operations.reverse().forEach((op, index) => {
      content += `-- Operation ${index + 1}\n`;
      content += `-- Original: ${op.original.substring(0, 100)}${op.original.length > 100 ? '...' : ''}\n`;
      content += `-- Confidence: ${op.confidence}\n`;
      if (op.notes) {
        content += `-- Notes: ${op.notes}\n`;
      }
      content += `${op.rollback}\n\n`;
    });

    fs.writeFileSync(rollbackPath, content);
    console.log(`\n✅ Rollback script generated: ${rollbackPath}`);
  }

  /**
   * Print summary of rollback operations
   */
  private printSummary(migrationName: string, operations: RollbackOperation[]): void {
    console.log('\n' + '='.repeat(80));
    console.log(`Rollback Summary for: ${migrationName}`);
    console.log('='.repeat(80));

    const high = operations.filter(op => op.confidence === 'high').length;
    const medium = operations.filter(op => op.confidence === 'medium').length;
    const low = operations.filter(op => op.confidence === 'low').length;

    console.log(`\nTotal operations: ${operations.length}`);
    console.log(`  ✅ High confidence (automatic): ${high}`);
    console.log(`  ⚠️  Medium confidence (review): ${medium}`);
    console.log(`  ❌ Low confidence (manual): ${low}`);

    if (low > 0) {
      console.log('\n⚠️  WARNING: Some operations require manual rollback!');
      console.log('Review the rollback.sql file and prepare manual steps.');
    }

    console.log('\n' + '='.repeat(80) + '\n');
  }

  /**
   * Get all migrations
   */
  private getAllMigrations(): string[] {
    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }

    return fs.readdirSync(this.migrationsDir)
      .filter(file => {
        const stat = fs.statSync(path.join(this.migrationsDir, file));
        return stat.isDirectory() && file !== 'migration_lock.toml';
      })
      .sort();
  }
}

// CLI interface
if (require.main === module) {
  const migrationName = process.argv[2];
  const generator = new RollbackGenerator();

  if (migrationName) {
    console.log(`Generating rollback for migration: ${migrationName}`);
    generator.generateRollback(migrationName);
  } else {
    console.log('Generating rollback for latest migration...');
    generator.generateRollback();
  }
}

export default RollbackGenerator;
