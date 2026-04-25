# Migration Example: Adding KYC Customer Table

This document demonstrates a complete migration workflow using the Migration Integrity Checker.

## Scenario

We need to add a new `KycCustomer` table to store KYC (Know Your Customer) information for users.

## Step 1: Update Prisma Schema

Edit `prisma/schema.prisma`:

```prisma
model KycCustomer {
  id          String    @id @default(uuid())
  userId      String    @unique
  user        User      @relation(fields: [userId], references: [id])
  firstName   String?
  lastName    String?
  email       String?
  status      KYCStatus @default(PENDING)
  extraFields Json?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([userId])
}

enum KYCStatus {
  PENDING
  ACCEPTED
  REJECTED
}
```

## Step 2: Create Migration

```bash
cd backend
npm run migrate:dev -- --name add_kyc_customer
```

This generates:
- `prisma/migrations/[timestamp]_add_kyc_customer/migration.sql`

## Step 3: Review Generated SQL

Check the generated migration:

```bash
cat prisma/migrations/[timestamp]_add_kyc_customer/migration.sql
```

Expected output:
```sql
-- CreateEnum
CREATE TYPE "KYCStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "KycCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "status" "KYCStatus" NOT NULL DEFAULT 'PENDING',
    "extraFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KycCustomer_userId_key" ON "KycCustomer"("userId");

-- CreateIndex
CREATE INDEX "KycCustomer_userId_idx" ON "KycCustomer"("userId");

-- AddForeignKey
ALTER TABLE "KycCustomer" ADD CONSTRAINT "KycCustomer_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

## Step 4: Run Integrity Checks

```bash
npm run migrate:check
```

Expected output:
```
🔍 Starting Migration Integrity Checks...

📊 Migration Integrity Check Results:

================================================================================

✅ PASSED:
   - Pending Migrations: No pending migrations found
   - Schema Drift: No schema drift detected
   - Migration Files: All 2 migration files are valid
   - Rollback Simulation: Latest migration appears reversible

================================================================================

Total: 4 checks | ✅ 4 passed | ⚠️  0 warnings | ❌ 0 errors

✅ All migration integrity checks passed!
```

## Step 5: Generate Rollback Script

```bash
npm run migrate:rollback
```

This creates `prisma/migrations/[timestamp]_add_kyc_customer/rollback.sql`:

```sql
-- ROLLBACK SCRIPT
-- Generated automatically - REVIEW BEFORE EXECUTING
-- Execute these statements in reverse order to rollback the migration

-- Operation 1
-- Original: ALTER TABLE "KycCustomer" ADD CONSTRAINT "KycCustomer_userId_fkey"...
-- Confidence: high
ALTER TABLE "KycCustomer" DROP CONSTRAINT IF EXISTS "KycCustomer_userId_fkey";

-- Operation 2
-- Original: CREATE INDEX "KycCustomer_userId_idx" ON "KycCustomer"("userId");
-- Confidence: high
DROP INDEX IF EXISTS "KycCustomer_userId_idx";

-- Operation 3
-- Original: CREATE UNIQUE INDEX "KycCustomer_userId_key" ON "KycCustomer"("userId");
-- Confidence: high
DROP INDEX IF EXISTS "KycCustomer_userId_key";

-- Operation 4
-- Original: CREATE TABLE "KycCustomer" (...)
-- Confidence: high
DROP TABLE IF EXISTS "KycCustomer";

-- Operation 5
-- Original: CREATE TYPE "KYCStatus" AS ENUM (...)
-- Confidence: medium
-- MANUAL ROLLBACK REQUIRED: Drop enum type "KYCStatus"
```

## Step 6: Test Locally

```bash
# Apply migration
npm run migrate:deploy

# Verify schema
npm run migrate:status

# Test application
npm run dev
```

## Step 7: Commit Changes

```bash
git add prisma/
git commit -m "feat: add KYC customer table for user verification"
```

The pre-commit hook will run integrity checks automatically.

## Step 8: Create Pull Request

When you create a PR, GitHub Actions will:

1. Run migration integrity checks
2. Check for schema drift
3. Validate migration files
4. Generate and upload migration report
5. Comment on PR with results

## Step 9: Deploy to Staging

After PR approval and merge to `staging`:

```bash
# On staging server
cd backend
npm run migrate:safe
```

This will:
1. Run integrity checks
2. Apply migrations if checks pass
3. Verify deployment

## Step 10: Deploy to Production

Before production deployment:

1. **Create Database Backup**
   ```bash
   # Backup production database
   pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Schedule Maintenance Window**
   - Notify users
   - Plan rollback procedure
   - Have team on standby

3. **Deploy Migration**
   ```bash
   # On production server
   cd backend
   npm run migrate:safe
   ```

4. **Verify Deployment**
   ```bash
   # Check migration status
   npm run migrate:status
   
   # Verify application health
   curl https://api.example.com/health
   ```

5. **Monitor Application**
   - Check logs for errors
   - Monitor database performance
   - Verify KYC functionality

## Rollback Procedure (If Needed)

If issues occur after deployment:

1. **Stop Application**
   ```bash
   systemctl stop backend
   ```

2. **Execute Rollback**
   ```bash
   psql $DATABASE_URL < prisma/migrations/[timestamp]_add_kyc_customer/rollback.sql
   ```

3. **Restore Previous Version**
   ```bash
   git checkout [previous-commit]
   npm install
   npm run build
   ```

4. **Restart Application**
   ```bash
   systemctl start backend
   ```

5. **Verify Rollback**
   ```bash
   npm run migrate:status
   curl https://api.example.com/health
   ```

## Example: Destructive Change (DROP COLUMN)

If you need to remove a column:

### ❌ Bad Approach

```prisma
model User {
  id        String   @id @default(uuid())
  publicKey String   @unique
  // email  String?  // Removed without migration strategy
  createdAt DateTime @default(now())
}
```

### ✅ Good Approach

**Step 1: Deprecate Column**
```typescript
// Mark as deprecated in code
interface User {
  id: string;
  publicKey: string;
  /** @deprecated Use contactEmail instead */
  email?: string;
  contactEmail?: string;
}
```

**Step 2: Add New Column**
```prisma
model User {
  id           String   @id @default(uuid())
  publicKey    String   @unique
  email        String?  // Keep temporarily
  contactEmail String?  // New column
  createdAt    DateTime @default(now())
}
```

**Step 3: Migrate Data**
```sql
-- In a separate migration
UPDATE "User" SET "contactEmail" = "email" WHERE "email" IS NOT NULL;
```

**Step 4: Update Application Code**
```typescript
// Update all references to use contactEmail
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: { contactEmail: true }
});
```

**Step 5: Remove Old Column (After Verification)**
```prisma
model User {
  id           String   @id @default(uuid())
  publicKey    String   @unique
  contactEmail String?
  createdAt    DateTime @default(now())
}
```

The integrity checker will flag this:
```
❌ ERRORS:
   - Destructive Change: 20260401000000_remove_email_column
     DROP COLUMN detected in migration. This may cause data loss.
```

**Step 6: Document and Approve**
Add to migration file:
```sql
-- APPROVED: Removing deprecated email column
-- Data migrated to contactEmail in previous migration
-- Verified no application code uses this column
-- Backup created: backup_20260401.sql
ALTER TABLE "User" DROP COLUMN "email";
```

## Best Practices Demonstrated

1. ✅ Always review generated SQL
2. ✅ Run integrity checks before committing
3. ✅ Generate rollback scripts
4. ✅ Test on staging first
5. ✅ Create backups before production deployment
6. ✅ Have rollback plan ready
7. ✅ Monitor after deployment
8. ✅ Use multi-step approach for destructive changes

## Common Pitfalls to Avoid

1. ❌ Skipping integrity checks
2. ❌ Not testing rollback procedures
3. ❌ Deploying without backups
4. ❌ Making destructive changes without data migration
5. ❌ Not documenting breaking changes
6. ❌ Deploying during peak hours
7. ❌ Not having monitoring in place

## Conclusion

This workflow ensures:
- Safe database migrations
- Minimal downtime
- Easy rollback if needed
- Clear audit trail
- Team confidence in deployments
