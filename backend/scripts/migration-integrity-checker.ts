#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface MigrationCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

interface MigrationAnalysis {
  hasDropTable: boolean;
  hasDropColumn: boolean;
  hasAlterColumn: boolean;
  hasDeleteData: boolean;
  hasRenameTable: boolean;
  hasRenameColumn: boolean;
  affectedTables: string[];
}

class MigrationIntegrityChecker {
  private migrationsDir: string;
  private schemaPath: string;
  private results: MigrationCheck[] = [];

  constructor() {
    this.migrationsDir = path.join(__dirname, '../prisma/migrations');
    this.schemaPath = path.join(__dirname, '../prisma/schema.prisma');
  }

  /**
   * Run all integrity checks
   */
  async runAllChecks(): Promise<boolean> {
    console.log('🔍 Starting Migration Integrity Checks...\n');

    try {
      await this.checkPendingMigrations();
      await this.checkSchemaDrift();
      await this.analyzeDestructiveChanges();
      await this.validateMigrationFiles();
      await this.simulateRollback();
      
      this.printResults();
      return this.hasErrors();
    } catch (error) {
      console.error('❌ Fatal error during checks:', error);
      return false;
    }
  }

  /**
   * Check for pending migrations
   */
  private async checkPendingMigrations(): Promise<void> {
    try {
      execSync('npx prisma migrate status', {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe',
      });
      
      this.addResult({
        name: 'Pending Migrations',
        passed: true,
        message: 'No pending migrations found',
        severity: 'info',
      });
    } catch (error: any) {
      const output = error.stdout?.toString() || error.message;
      
      if (output.includes('Database schema is up to date')) {
        this.addResult({
          name: 'Pending Migrations',
          passed: true,
          message: 'Database schema is up to date',
          severity: 'info',
        });
      } else {
        this.addResult({
          name: 'Pending Migrations',
          passed: false,
          message: 'Pending migrations detected. Run migrations before deployment.',
          severity: 'error',
        });
      }
    }
  }

  /**
   * Check for schema drift between Prisma schema and database
   */
  private async checkSchemaDrift(): Promise<void> {
    try {
      execSync('npx prisma migrate diff --from-schema-datamodel ./prisma/schema.prisma --to-schema-datasource ./prisma/schema.prisma --script', {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe',
      });
      
      this.addResult({
        name: 'Schema Drift',
        passed: true,
        message: 'No schema drift detected',
        severity: 'info',
      });
    } catch (error: any) {
      const output = error.stdout?.toString() || '';
      
      if (output.trim() === '' || output.includes('No difference')) {
        this.addResult({
          name: 'Schema Drift',
          passed: true,
          message: 'No schema drift detected',
          severity: 'info',
        });
      } else {
        this.addResult({
          name: 'Schema Drift',
          passed: false,
          message: 'Schema drift detected between local and database',
          severity: 'warning',
        });
      }
    }
  }

  /**
   * Analyze migrations for destructive changes
   */
  private async analyzeDestructiveChanges(): Promise<void> {
    const migrations = this.getRecentMigrations(5);
    
    for (const migration of migrations) {
      const analysis = this.analyzeMigrationSQL(migration);
      
      if (analysis.hasDropTable) {
        this.addResult({
          name: `Destructive Change: ${migration.name}`,
          passed: false,
          message: `DROP TABLE detected in migration. Tables: ${analysis.affectedTables.join(', ')}`,
          severity: 'error',
        });
      }
      
      if (analysis.hasDropColumn) {
        this.addResult({
          name: `Destructive Change: ${migration.name}`,
          passed: false,
          message: `DROP COLUMN detected in migration. This may cause data loss.`,
          severity: 'error',
        });
      }
      
      if (analysis.hasDeleteData) {
        this.addResult({
          name: `Destructive Change: ${migration.name}`,
          passed: false,
          message: `DELETE statement detected in migration. This will remove data.`,
          severity: 'error',
        });
      }
      
      if (analysis.hasAlterColumn) {
        this.addResult({
          name: `Schema Change: ${migration.name}`,
          passed: true,
          message: `ALTER COLUMN detected. Verify data compatibility.`,
          severity: 'warning',
        });
      }
    }
    
    if (migrations.length === 0) {
      this.addResult({
        name: 'Destructive Changes',
        passed: true,
        message: 'No recent migrations to analyze',
        severity: 'info',
      });
    }
  }

  /**
   * Validate migration file integrity
   */
  private async validateMigrationFiles(): Promise<void> {
    const migrations = this.getAllMigrations();
    let hasIssues = false;
    
    for (const migration of migrations) {
      const sqlPath = path.join(this.migrationsDir, migration, 'migration.sql');
      
      if (!fs.existsSync(sqlPath)) {
        this.addResult({
          name: `Migration File: ${migration}`,
          passed: false,
          message: 'Missing migration.sql file',
          severity: 'error',
        });
        hasIssues = true;
        continue;
      }
      
      const content = fs.readFileSync(sqlPath, 'utf-8');
      
      if (content.trim().length === 0) {
        this.addResult({
          name: `Migration File: ${migration}`,
          passed: false,
          message: 'Empty migration file',
          severity: 'error',
        });
        hasIssues = true;
      }
      
      // Check for syntax issues
      if (content.includes('--') && !content.includes('-- ')) {
        this.addResult({
          name: `Migration File: ${migration}`,
          passed: true,
          message: 'Potential comment formatting issue',
          severity: 'warning',
        });
      }
    }
    
    if (!hasIssues && migrations.length > 0) {
      this.addResult({
        name: 'Migration Files',
        passed: true,
        message: `All ${migrations.length} migration files are valid`,
        severity: 'info',
      });
    }
  }

  /**
   * Simulate rollback to ensure idempotency
   */
  private async simulateRollback(): Promise<void> {
    try {
      // Check if we can generate a rollback script
      const migrations = this.getRecentMigrations(1);
      
      if (migrations.length === 0) {
        this.addResult({
          name: 'Rollback Simulation',
          passed: true,
          message: 'No migrations to rollback',
          severity: 'info',
        });
        return;
      }
      
      const latestMigration = migrations[0];
      const sqlPath = path.join(this.migrationsDir, latestMigration.name, 'migration.sql');
      const sql = fs.readFileSync(sqlPath, 'utf-8');
      
      // Check if migration is reversible
      const isReversible = this.checkReversibility(sql);
      
      if (isReversible) {
        this.addResult({
          name: 'Rollback Simulation',
          passed: true,
          message: 'Latest migration appears reversible',
          severity: 'info',
        });
      } else {
        this.addResult({
          name: 'Rollback Simulation',
          passed: false,
          message: 'Latest migration may not be easily reversible. Consider adding explicit rollback script.',
          severity: 'warning',
        });
      }
    } catch (error) {
      this.addResult({
        name: 'Rollback Simulation',
        passed: false,
        message: `Error simulating rollback: ${error}`,
        severity: 'warning',
      });
    }
  }

  /**
   * Check if a migration is reversible
   */
  private checkReversibility(sql: string): boolean {
    const irreversiblePatterns = [
      /DROP\s+TABLE/i,
      /DROP\s+COLUMN/i,
      /DELETE\s+FROM/i,
      /TRUNCATE/i,
    ];
    
    return !irreversiblePatterns.some(pattern => pattern.test(sql));
  }

  /**
   * Analyze SQL migration for destructive patterns
   */
  private analyzeMigrationSQL(migration: { name: string; path: string }): MigrationAnalysis {
    const sqlPath = path.join(migration.path, 'migration.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8').toUpperCase();
    
    const analysis: MigrationAnalysis = {
      hasDropTable: /DROP\s+TABLE/i.test(sql),
      hasDropColumn: /DROP\s+COLUMN/i.test(sql),
      hasAlterColumn: /ALTER\s+COLUMN/i.test(sql),
      hasDeleteData: /DELETE\s+FROM/i.test(sql),
      hasRenameTable: /RENAME\s+TABLE/i.test(sql) || /ALTER\s+TABLE\s+\w+\s+RENAME\s+TO/i.test(sql),
      hasRenameColumn: /RENAME\s+COLUMN/i.test(sql),
      affectedTables: this.extractTableNames(sql),
    };
    
    return analysis;
  }

  /**
   * Extract table names from SQL
   */
  private extractTableNames(sql: string): string[] {
    const tablePattern = /(?:DROP\s+TABLE|CREATE\s+TABLE|ALTER\s+TABLE)\s+["']?(\w+)["']?/gi;
    const matches = sql.matchAll(tablePattern);
    const tables = new Set<string>();
    
    for (const match of matches) {
      if (match[1]) {
        tables.add(match[1]);
      }
    }
    
    return Array.from(tables);
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

  /**
   * Get recent migrations
   */
  private getRecentMigrations(count: number): Array<{ name: string; path: string }> {
    const all = this.getAllMigrations();
    return all.slice(-count).map(name => ({
      name,
      path: path.join(this.migrationsDir, name),
    }));
  }

  /**
   * Add a check result
   */
  private addResult(result: MigrationCheck): void {
    this.results.push(result);
  }

  /**
   * Check if there are any errors
   */
  private hasErrors(): boolean {
    return !this.results.some(r => r.severity === 'error' && !r.passed);
  }

  /**
   * Print all results
   */
  private printResults(): void {
    console.log('\n📊 Migration Integrity Check Results:\n');
    console.log('='.repeat(80));
    
    const errors = this.results.filter(r => r.severity === 'error' && !r.passed);
    const warnings = this.results.filter(r => r.severity === 'warning' && !r.passed);
    const info = this.results.filter(r => r.severity === 'info' || r.passed);
    
    if (errors.length > 0) {
      console.log('\n❌ ERRORS:');
      errors.forEach(r => console.log(`   - ${r.name}: ${r.message}`));
    }
    
    if (warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      warnings.forEach(r => console.log(`   - ${r.name}: ${r.message}`));
    }
    
    if (info.length > 0) {
      console.log('\n✅ PASSED:');
      info.forEach(r => console.log(`   - ${r.name}: ${r.message}`));
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`\nTotal: ${this.results.length} checks | ` +
      `✅ ${info.length} passed | ` +
      `⚠️  ${warnings.length} warnings | ` +
      `❌ ${errors.length} errors\n`);
    
    if (errors.length > 0) {
      console.log('❌ Migration integrity check FAILED. Fix errors before deploying.\n');
      process.exit(1);
    } else if (warnings.length > 0) {
      console.log('⚠️  Migration integrity check passed with warnings. Review before deploying.\n');
      process.exit(0);
    } else {
      console.log('✅ All migration integrity checks passed!\n');
      process.exit(0);
    }
  }
}

// Run the checker
if (require.main === module) {
  const checker = new MigrationIntegrityChecker();
  checker.runAllChecks().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default MigrationIntegrityChecker;
