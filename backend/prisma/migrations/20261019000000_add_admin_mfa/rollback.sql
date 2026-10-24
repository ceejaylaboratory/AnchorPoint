-- Rollback: remove MFA columns from AdminUser
ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "mfaBackupCodes";
ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "mfaSecret";
ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "mfaEnabled";
