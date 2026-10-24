-- CreateTable
CREATE TABLE "FeeSchedule" (
    "id" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "feeType" TEXT NOT NULL,
    "feeFixed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeMinimum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeSchedule_assetCode_effectiveFrom_idx" ON "FeeSchedule"("assetCode", "effectiveFrom");
