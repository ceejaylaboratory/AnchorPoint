-- AlterTable
ALTER TABLE "User" ADD COLUMN "phone" TEXT;

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "contractId" TEXT,
    "functionName" TEXT,
    "parameters" JSONB,
    "result" JSONB,
    "error" TEXT,
    "errorCategory" TEXT,
    "errorSeverity" TEXT,
    "errorCode" TEXT,
    "userMessage" TEXT,
    "suggestedAction" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "createdBy" TEXT,
    "metadata" JSONB,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_transactionId_idx" ON "Notification"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractJob_jobId_key" ON "ContractJob"("jobId");

-- CreateIndex
CREATE INDEX "ContractJob_jobId_idx" ON "ContractJob"("jobId");

-- CreateIndex
CREATE INDEX "ContractJob_status_idx" ON "ContractJob"("status");

-- CreateIndex
CREATE INDEX "ContractJob_createdBy_idx" ON "ContractJob"("createdBy");

-- CreateIndex
CREATE INDEX "ContractJob_type_idx" ON "ContractJob"("type");
