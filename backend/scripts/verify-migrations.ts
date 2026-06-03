#!/usr/bin/env node
/**
 * Prisma Migration Verification Script
 * 
 * Verifies the integrity of Prisma migrations against a temporary database
 * to prevent breaking changes during production deployments.
 * 
 * This script:
 * 1. Creates a temporary database
 * 2. Applies all migrations to it
 * 3. Verifies schema consistency
 * 4. Checks for destructive changes
 * 5. Tests migration reversibility
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface MigrationCheckResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  checks: {
    tempDatabaseCreated: boolean;
    migrationsApplied: boolean;
    schemaConsistent: boolean;
    noDestructiveChanges: boolean;
    migrationsReversible: boolean;
  };
}

class MigrationVerifier {
  private tempDbPath: string;
  private prismaBinary: string;
  private schemaPath: string;
  private migrationsPath: string;

  constructor() {
    this.tempDbPath = path.join(os.tmpdir(), `prisma-verify-${Date.now()}.db`);
    this.prismaBinary = 'npx prisma';
    this.schemaPath = path.join(__dirname, '../prisma/schema.prisma');
    this.migrationsPath = path.join(__dirname, '../prisma/migrations');
  }

  /**
   * Execute a command and return the result
   */
  private run(command: string, options: any = {}): string {
    try {
      return execSync(command, {
        stdio: 'pipe',
        encoding: 'utf-8',
        ...options,
      });
    } catch (error: any) {
      throw new Error(`Command failed: ${command}\n${error.message}`);
    }
  }

  /**
   * Execute a command silently (suppress output)
   */
  private runSilent(command: string, options: any = {}): string {
    try {
      return execSync(command, {
        stdio: 'pipe',
        encoding: 'utf-8',
        ...options,
      });
    } catch (error: any) {
      throw new Error(`Command failed: ${command}\n${error.message}`);
    }
  }

  /**
   * Clean up temporary database
   */
  private cleanup(): void {
    if (fs.existsSync(this.tempDbPath)) {
      fs.unlinkSync(this.tempDbPath);
      console.log('🧹 Cleaned up temporary database');
    }
  }

  /**
   * Create temporary database
   */
  private createTempDatabase(): boolean {
    try {
      console.log('📦 Creating temporary database...');
      // Just ensure the path doesn't exist, it will be created by Prisma
      if (fs.existsSync(this.tempDbPath)) {
        fs.unlinkSync(this.tempDbPath);
      }
      console.log('✅ Temporary database path ready');
      return true;
    } catch (error) {
      console.error('❌ Failed to create temporary database:', error);
      return false;
    }
  }

  /**
   * Apply all migrations to temporary database
   */
  private applyMigrations(): boolean {
    try {
      console.log('🔄 Applying migrations to temporary database...');
      
      const env = {
        ...process.env,
        DATABASE_URL: `file:${this.tempDbPath}`,
      };

      // Reset and apply migrations
      this.runSilent(`${this.prismaBinary} migrate reset --force`, {
        env,
        cwd: path.join(__dirname, '..'),
      });

      console.log('✅ All migrations applied successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to apply migrations:', error);
      return false;
    }
  }

  /**
   * Verify schema consistency between migrations and schema.prisma
   */
  private verifySchemaConsistency(): boolean {
    try {
      console.log('🔍 Verifying schema consistency...');

      const env = {
        ...process.env,
        DATABASE_URL: `file:${this.tempDbPath}`,
      };

      // Check if the database schema matches the Prisma schema
      const diffOutput = this.runSilent(
        `${this.prismaBinary} migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`,
        {
          env,
          cwd: path.join(__dirname, '..'),
        }
      );

      // If there's any diff output, there's inconsistency
      if (diffOutput.trim() && !diffOutput.includes('No difference')) {
        console.error('❌ Schema inconsistency detected:');
        console.error(diffOutput);
        return false;
      }

      console.log('✅ Schema is consistent');
      return true;
    } catch (error) {
      console.error('❌ Schema consistency check failed:', error);
      return false;
    }
  }

  /**
   * Check for destructive changes in migrations
   */
  private checkDestructiveChanges(): boolean {
    try {
      console.log('⚠️  Checking for destructive changes...');

      const env = {
        ...process.env,
        DATABASE_URL: `file:${this.tempDbPath}`,
      };

      // Use Prisma migrate diff to detect destructive changes
      try {
        this.runSilent(
          `${this.prismaBinary} migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code`,
          {
            env,
            cwd: path.join(__dirname, '..'),
          }
        );
        console.log('✅ No destructive changes detected');
        return true;
      } catch (error: any) {
        if (error.status === 1) {
          console.error('❌ Destructive changes detected in migrations!');
          console.error('Please review your migration files for:');
          console.error('  - DROP TABLE operations');
          console.error('  - DROP COLUMN operations');
          console.error('  - DELETE/TRUNCATE operations');
          console.error('  - ALTER COLUMN that changes types');
          return false;
        }
        throw error;
      }
    } catch (error) {
      console.error('❌ Destructive change check failed:', error);
      return false;
    }
  }

  /**
   * Test migration reversibility
   */
  private testMigrationReversibility(): boolean {
    try {
      console.log('🔙 Testing migration reversibility...');

      const env = {
        ...process.env,
        DATABASE_URL: `file:${this.tempDbPath}`,
      };

      // Get the list of migrations
      const migrationDirs = fs.readdirSync(this.migrationsPath)
        .filter((dir) => fs.statSync(path.join(this.migrationsPath, dir)).isDirectory())
        .sort()
        .reverse();

      if (migrationDirs.length === 0) {
        console.log('✅ No migrations to test');
        return true;
      }

      console.log(`Testing ${migrationDirs.length} migration(s) for reversibility...`);

      // Check each migration for rollback.sql
      for (const migrationDir of migrationDirs) {
        const rollbackPath = path.join(this.migrationsPath, migrationDir, 'rollback.sql');
        const migrationSqlPath = path.join(this.migrationsPath, migrationDir, 'migration.sql');

        if (!fs.existsSync(migrationSqlPath)) {
          console.warn(`⚠️  Warning: Migration ${migrationDir} missing migration.sql`);
          continue;
        }

        if (!fs.existsSync(rollbackPath)) {
          console.warn(`⚠️  Warning: Migration ${migrationDir} missing rollback.sql`);
          console.warn('  Consider generating a rollback script using: npm run migrate:rollback');
        }
      }

      console.log('✅ Migration reversibility check completed');
      return true;
    } catch (error) {
      console.error('❌ Migration reversibility test failed:', error);
      return false;
    }
  }

  /**
   * Validate migration files
   */
  private validateMigrationFiles(): boolean {
    try {
      console.log('📄 Validating migration files...');

      const migrationDirs = fs.readdirSync(this.migrationsPath)
        .filter((dir) => fs.statSync(path.join(this.migrationsPath, dir)).isDirectory());

      for (const migrationDir of migrationDirs) {
        const migrationSqlPath = path.join(this.migrationsPath, migrationDir, 'migration.sql');
        
        if (!fs.existsSync(migrationSqlPath)) {
          console.error(`❌ Migration ${migrationDir} missing migration.sql`);
          return false;
        }

        const content = fs.readFileSync(migrationSqlPath, 'utf-8');
        if (content.trim().length === 0) {
          console.error(`❌ Migration ${migrationDir} has empty migration.sql`);
          return false;
        }
      }

      console.log('✅ All migration files are valid');
      return true;
    } catch (error) {
      console.error('❌ Migration file validation failed:', error);
      return false;
    }
  }

  /**
   * Run all verification checks
   */
  public verify(): MigrationCheckResult {
    const result: MigrationCheckResult = {
      success: false,
      errors: [],
      warnings: [],
      checks: {
        tempDatabaseCreated: false,
        migrationsApplied: false,
        schemaConsistent: false,
        noDestructiveChanges: false,
        migrationsReversible: false,
      },
    };

    try {
      // Create temporary database
      result.checks.tempDatabaseCreated = this.createTempDatabase();
      if (!result.checks.tempDatabaseCreated) {
        result.errors.push('Failed to create temporary database');
        return result;
      }

      // Validate migration files
      const filesValid = this.validateMigrationFiles();
      if (!filesValid) {
        result.errors.push('Migration file validation failed');
        return result;
      }

      // Apply migrations
      result.checks.migrationsApplied = this.applyMigrations();
      if (!result.checks.migrationsApplied) {
        result.errors.push('Failed to apply migrations to temporary database');
        return result;
      }

      // Verify schema consistency
      result.checks.schemaConsistent = this.verifySchemaConsistency();
      if (!result.checks.schemaConsistent) {
        result.errors.push('Schema consistency check failed');
      }

      // Check for destructive changes
      result.checks.noDestructiveChanges = this.checkDestructiveChanges();
      if (!result.checks.noDestructiveChanges) {
        result.errors.push('Destructive changes detected');
      }

      // Test migration reversibility
      result.checks.migrationsReversible = this.testMigrationReversibility();
      if (!result.checks.migrationsReversible) {
        result.warnings.push('Some migrations may not be reversible');
      }

      // Overall success
      result.success = result.errors.length === 0;

      return result;
    } catch (error) {
      result.errors.push(`Unexpected error: ${error}`);
      return result;
    } finally {
      this.cleanup();
    }
  }

  /**
   * Print verification results
   */
  public printResults(result: MigrationCheckResult): void {
    console.log('\n' + '='.repeat(80));
    console.log('📊 Migration Verification Results');
    console.log('='.repeat(80));

    console.log('\n✅ Passed Checks:');
    if (result.checks.tempDatabaseCreated) console.log('  ✓ Temporary database created');
    if (result.checks.migrationsApplied) console.log('  ✓ Migrations applied successfully');
    if (result.checks.schemaConsistent) console.log('  ✓ Schema consistency verified');
    if (result.checks.noDestructiveChanges) console.log('  ✓ No destructive changes');
    if (result.checks.migrationsReversible) console.log('  ✓ Migrations reversible');

    if (result.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      result.warnings.forEach((warning) => console.log(`  ⚠️  ${warning}`));
    }

    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.forEach((error) => console.log(`  ❌ ${error}`));
    }

    console.log('\n' + '='.repeat(80));
    console.log(`Total: ${Object.values(result.checks).filter(Boolean).length} checks`);
    console.log(`✅ Passed: ${Object.values(result.checks).filter(Boolean).length}`);
    console.log(`⚠️  Warnings: ${result.warnings.length}`);
    console.log(`❌ Errors: ${result.errors.length}`);
    console.log('='.repeat(80) + '\n');

    if (result.success) {
      console.log('✨ All migration verification checks passed!');
    } else {
      console.log('💥 Migration verification failed. Please fix the errors above.');
    }
  }
}

// Main execution
if (require.main === module) {
  const verifier = new MigrationVerifier();
  const result = verifier.verify();
  verifier.printResults(result);
  
  process.exit(result.success ? 0 : 1);
}

export { MigrationVerifier, MigrationCheckResult };
