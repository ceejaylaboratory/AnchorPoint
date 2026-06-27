# Database Migration Integrity Checker

## Overview

The Migration Integrity Checker is a comprehensive tool designed to validate Prisma migrations during the CI/CD pipeline, preventing destructive changes to production databases and ensuring migration safety.

## Features

### 1. Destructive Change Detection
- **DROP TABLE**: Detects table deletions that could cause data loss
- **DROP COLUMN**: Identifies column removals that may affect existing data
- **DELETE statements**: Flags data deletion operations
- **ALTER COLUMN**: Warns about column type changes that may cause compatibility issues

### 2. Schema Drift Detection
- Compares Prisma schema with actual database state
- Identifies discrepancies between local and staging environments
- Prevents deployment of out-of-sync schemas

### 3. Migration File Validation
- Ensures all migrations have valid SQL files
- Checks for empty or malformed migration files
- Validates migration file structure

### 4. Rollback Simulation
- Analyzes migration reversibility
- Identifies irreversible operations
- Recommends explicit rollback scripts when needed

### 5. Pending Migration Detection
- Checks for unapplied migrations
- Ensures database is up-to-date before deployment

## Usage

### Local Development

Run the integrity checker manually:

```bash
cd backend
npx ts-node scripts/migration-integrity-checker.ts
```

### CI/CD Integration

The checker runs automatically on:
- Pull requests affecting Prisma files
- Pushes to `main` or `staging` branches

### Adding to package.json

Add these scripts to your `backend/package.json`:

```json
{
  "scripts": {
    "migrate:check": "ts-node scripts/migration-integrity-checker.ts",
    "migrate:safe": "npm run migrate:check && npx prisma migrate deploy",
    "migrate:dev": "npx prisma migrate dev",
    "migrate:deploy": "npx prisma migrate deploy"
  }
}
```

## Configuration

### Environment Variables

```bash
# Database URL for testing
DATABASE_URL="file:./dev.db"

# Optional: Set to 'true' to treat warnings as errors
STRICT_MIGRATION_CHECK="false"
```

### Customizing Checks

Edit `backend/scripts/migration-integrity-checker.ts` to:
- Add custom validation rules
- Modify severity levels
- Add project-specific checks

## Best Practices

### 1. Safe Migration Patterns

✅ **DO:**
- Add new tables and columns
- Create indexes
- Add constraints with validation
- Use data migrations in separate steps

❌ **DON'T:**
- Drop tables without backup
- Remove columns with data
- Change column types without migration path
- Combine schema and data changes

### 2. Migration Workflow

1. **Create Migration**
   ```bash
   npx prisma migrate dev --name descriptive_name
   ```

2. **Review Generated SQL**
   - Check `prisma/migrations/[timestamp]_[name]/migration.sql`
   - Verify no destructive changes

3. **Run Integrity Check**
   ```bash
   npm run migrate:check
   ```

4. **Test Locally**
   - Apply migration to local database
   - Verify application functionality
   - Test rollback if possible

5. **Deploy to Staging**
   - CI/CD runs integrity checks automatically
   - Monitor for issues

6. **Deploy to Production**
   - Backup database first
   - Apply migration during maintenance window
   - Monitor application health

### 3. Handling Destructive Changes

If you must make destructive changes:

1. **Create Backup Migration**
   ```sql
   -- Create backup table
   CREATE TABLE "User_backup" AS SELECT * FROM "User";
   ```

2. **Add Rollback Script**
   Create `migration.rollback.sql` alongside `migration.sql`

3. **Document the Change**
   Add comments explaining the necessity and impact

4. **Coordinate with Team**
   - Notify all stakeholders
   - Plan maintenance window
   - Prepare rollback procedure

### 4. Schema Drift Prevention

- Always use Prisma migrations (never manual SQL)
- Keep schema.prisma as source of truth
- Run `prisma db pull` to sync from database if needed
- Regularly check for drift in CI/CD

## Troubleshooting

### "Pending migrations detected"

**Cause**: Migrations exist but haven't been applied to database

**Solution**:
```bash
npx prisma migrate deploy
```

### "Schema drift detected"

**Cause**: Database schema doesn't match Prisma schema

**Solution**:
```bash
# Option 1: Pull changes from database
npx prisma db pull

# Option 2: Reset database (development only!)
npx prisma migrate reset

# Option 3: Create migration to sync
npx prisma migrate dev
```

### "DROP TABLE detected"

**Cause**: Migration attempts to delete a table

**Solution**:
1. Verify this is intentional
2. Create data backup
3. Add explicit approval in migration
4. Document in PR

### "Migration file missing"

**Cause**: Migration directory exists without SQL file

**Solution**:
```bash
# Regenerate migration
npx prisma migrate dev --name [migration_name]
```

## CI/CD Pipeline Details

### GitHub Actions Workflow

The workflow (`migration-integrity.yml`) performs:

1. **Setup**
   - Checkout code with full history
   - Install Node.js and dependencies
   - Create test database

2. **Integrity Checks**
   - Run migration integrity checker
   - Check for schema drift
   - Validate migration files

3. **Reporting**
   - Generate migration report
   - Upload as artifact
   - Comment on PR with results

4. **Staging Tests** (staging branch only)
   - Clone staging database
   - Test migrations
   - Verify data integrity

### Exit Codes

- `0`: All checks passed
- `1`: Errors detected (blocks deployment)

### Artifacts

- `migration-report.md`: Detailed check results
- Retained for 30 days

## Advanced Usage

### Custom Validation Rules

Add custom checks in `MigrationIntegrityChecker`:

```typescript
private async checkCustomRule(): Promise<void> {
  // Your custom validation logic
  this.addResult({
    name: 'Custom Check',
    passed: true,
    message: 'Custom validation passed',
    severity: 'info',
  });
}
```

### Integration with Other Tools

```bash
# Run with other checks
npm run lint && npm run test && npm run migrate:check

# Pre-commit hook
npx husky add .husky/pre-commit "cd backend && npm run migrate:check"
```

### Monitoring and Alerts

Set up alerts for migration failures:

```yaml
# In GitHub Actions
- name: Notify on failure
  if: failure()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    text: 'Migration integrity check failed!'
```

## Migration Checklist

Before deploying migrations to production:

- [ ] Integrity checker passes
- [ ] No schema drift detected
- [ ] Tested on staging environment
- [ ] Database backup created
- [ ] Rollback plan documented
- [ ] Team notified of changes
- [ ] Monitoring alerts configured
- [ ] Maintenance window scheduled (if needed)

## Support

For issues or questions:
1. Check this documentation
2. Review migration logs
3. Consult with database team
4. Create issue in repository

## References

- [Prisma Migrations Documentation](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [Database Migration Best Practices](https://www.prisma.io/docs/guides/migrate/production-troubleshooting)
- [CI/CD Integration Guide](https://www.prisma.io/docs/guides/deployment/deployment-guides)
