-- Rollback: remove expiry columns from ApiKey
ALTER TABLE "ApiKey" DROP COLUMN IF EXISTS "lastUsedAt";
ALTER TABLE "ApiKey" DROP COLUMN IF EXISTS "expiresAt";
