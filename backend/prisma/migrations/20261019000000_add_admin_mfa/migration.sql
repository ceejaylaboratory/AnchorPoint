-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdminUser" ADD COLUMN "mfaSecret" TEXT;
ALTER TABLE "AdminUser" ADD COLUMN "mfaBackupCodes" TEXT;
