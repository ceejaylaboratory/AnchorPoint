-- Note: "User".phone, NotificationPreference, Notification, and ContractJob
-- were already created by 20260623000000_init_postgres (the canonical baseline).
-- This migration only adds the UploadRecord table which is new.

-- CreateTable
CREATE TABLE "UploadRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadRecord_key_key" ON "UploadRecord"("key");

-- CreateIndex
CREATE INDEX "UploadRecord_status_idx" ON "UploadRecord"("status");
