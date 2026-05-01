-- AlterTable
ALTER TABLE "KycCustomer" ADD COLUMN "provider" TEXT;
ALTER TABLE "KycCustomer" ADD COLUMN "providerRef" TEXT;

-- CreateIndex
CREATE INDEX "KycCustomer_provider_providerRef_idx" ON "KycCustomer"("provider", "providerRef");
