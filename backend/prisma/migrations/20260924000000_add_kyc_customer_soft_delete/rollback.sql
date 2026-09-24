-- Rollback: remove soft-delete support for KYC customers (#1197)
DROP INDEX IF EXISTS "KycCustomer_deletedAt_idx";
ALTER TABLE "KycCustomer" DROP COLUMN IF EXISTS "deletedAt";
