# Database Migration Scripts

This directory contains tools for managing and validating Prisma database migrations.

## Scripts

### 1. migration-integrity-checker.ts

Comprehensive tool for validating migrations during CI/CD pipeline.

**Usage:**
```bash
npm run migrate:check
# or
npx ts-node scripts/migration-integrity-checker.ts
```

**Features:**
- Detects destructive changes (DROP TABLE, DROP COLUMN, DELETE)
- Checks for schema drift
- Validates migration file integrity
- Simulates rollback scenarios
- Identifies pending migrations

**Exit Codes:**
- `0`: All checks passed
- `1`: Errors detected (blocks deployment)

### 2. generate-rollback.ts

Generates rollback scripts for Prisma migrations.

**Usage:**
```bash
# Generate rollback for latest migration
npm run migrate:rollback

# Generate rollback for specific migration
npx ts-node scripts/generate-rollback.ts 20260324124550_init
```

**Output:**
Creates a `rollback.sql` file in the migration directory with:
- Reverse operations for each migration step
- Confidence levels (high/medium/low)
- Manual intervention notes where needed

**Confidence Levels:**
- **High**: Automatic rollback possible (e.g., DROP TABLE for CREATE TABLE)
- **Medium**: Rollback possible with review (e.g., recreate index)
- **Low**: Manual intervention required (e.g., restore deleted data)

## Quick Start

### Running Checks Locally

```bash
cd backend

# Check migration integrity
npm run migrate:check

# Check migration status
npm run migrate:status

# Generate rollback script
npm run migrate:rollback
```

### Safe Migration Workflow

```bash
# 1. Create migration
npm run migrate:dev -- --name add_new_feature

# 2. Check integrity
npm run migrate:check

# 3. Generate rollback
npm run migrate:rollback

# 4. Review generated files
cat prisma/migrations/[latest]/rollback.sql

# 5. Deploy safely
npm run migrate:safe
```

## CI/CD Integration

The migration integrity checker runs automatically in GitHub Actions:

- On pull requests affecting `backend/prisma/**`
- On pushes to `main` or `staging` branches

See `.github/workflows/migration-integrity.yml` for configuration.

## Common Issues

### "Pending migrations detected"

**Solution:**
```bash
npx prisma migrate deploy
```

### "Schema drift detected"

**Solution:**
```bash
# Pull changes from database
npx prisma db pull

# Or create new migration
npm run migrate:dev
```

### "DROP TABLE detected"

**Solution:**
1. Verify this is intentional
2. Create backup: `npm run db:backup`
3. Document in PR
4. Proceed with caution

## Best Practices

1. **Always run integrity checks** before deploying migrations
2. **Generate rollback scripts** for all migrations
3. **Test on staging** before production
4. **Backup database** before destructive changes
5. **Document breaking changes** in migration comments

## Testing

Run tests for the migration checker:

```bash
npm test scripts/migration-integrity-checker.test.ts
```

## Documentation

For detailed documentation, see:
- [Migration Integrity Guide](../docs/MIGRATION_INTEGRITY.md)
- [Prisma Migration Docs](https://www.prisma.io/docs/concepts/components/prisma-migrate)

## Support

For issues or questions:
1. Check the documentation
2. Review migration logs
3. Create an issue in the repository
