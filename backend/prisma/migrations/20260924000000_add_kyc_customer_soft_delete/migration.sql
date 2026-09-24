-- AlterTable: soft-delete support for KYC customers (#1197)
ALTER TABLE "KycCustomer" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "KycCustomer_deletedAt_idx" ON "KycCustomer"("deletedAt");
