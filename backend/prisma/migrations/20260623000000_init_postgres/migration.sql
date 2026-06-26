-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('Free', 'Pro', 'Enterprise');

-- CreateEnum
CREATE TYPE "RecurringPaymentScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringPaymentRunStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "KYCStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MultisigStatus" AS ENUM ('PENDING', 'PARTIALLY_SIGNED', 'READY', 'SUBMITTED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPasswordResetToken" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "Tier" NOT NULL DEFAULT 'Free',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringPaymentSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "status" "RecurringPaymentScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringPaymentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringPaymentRun" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "status" "RecurringPaymentRunStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "stellarTxId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringPaymentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "externalId" TEXT,
    "stellarTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "feeAmount" TEXT DEFAULT '0',
    "feeAssetCode" TEXT,
    "feeType" TEXT,
    "senderInfo" JSONB,
    "receiverInfo" JSONB,
    "callbackUrl" TEXT,
    "sep31Status" TEXT,
    "requiredInfoMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "refunded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeReport" (
    "id" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "totalFees" TEXT NOT NULL,
    "totalFeesXLM" TEXT NOT NULL,
    "operationCounts" JSONB NOT NULL,
    "feeBreakdown" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filePath" TEXT,
    "fileType" TEXT,

    CONSTRAINT "FeeReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT,
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycCustomer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT,
    "providerRef" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "status" "KYCStatus" NOT NULL DEFAULT 'PENDING',
    "extraFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "sellAsset" TEXT NOT NULL,
    "sellAmount" TEXT NOT NULL,
    "buyAsset" TEXT NOT NULL,
    "buyAmount" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "settings" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractJob" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
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
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractEvent" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "ledgerClosedAt" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "contractEventId" TEXT NOT NULL,
    "topics" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultisigTransaction" (
    "id" TEXT NOT NULL,
    "envelopeXdr" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "creatorPublicKey" TEXT NOT NULL,
    "requiredSigners" JSONB NOT NULL,
    "threshold" INTEGER NOT NULL,
    "currentSignatures" INTEGER NOT NULL DEFAULT 0,
    "status" "MultisigStatus" NOT NULL DEFAULT 'PENDING',
    "memo" TEXT,
    "expiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "stellarTxId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultisigTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultisigSignature" (
    "id" TEXT NOT NULL,
    "multisigTransactionId" TEXT NOT NULL,
    "signerPublicKey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultisigSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultisigNotification" (
    "id" TEXT NOT NULL,
    "multisigTransactionId" TEXT NOT NULL,
    "recipientPublicKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultisigNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetValidationResult" (
    "assetCode" TEXT NOT NULL,
    "issuerPublicKey" TEXT NOT NULL,
    "homeDomain" TEXT,
    "complianceStatus" TEXT NOT NULL,
    "messages" TEXT NOT NULL,
    "rawToml" TEXT,
    "lastCrawledAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetValidationResult_pkey" PRIMARY KEY ("assetCode","issuerPublicKey")
);

-- CreateTable
CREATE TABLE "CrawlJobRecord" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "totalAssets" INTEGER NOT NULL,
    "compliantCount" INTEGER NOT NULL,
    "nonCompliantCount" INTEGER NOT NULL,
    "suspiciousCount" INTEGER NOT NULL,

    CONSTRAINT "CrawlJobRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_publicKey_key" ON "User"("publicKey");

-- CreateIndex
CREATE INDEX "User_publicKey_idx" ON "User"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_email_idx" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPasswordResetToken_tokenHash_key" ON "AdminPasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminPasswordResetToken_adminUserId_usedAt_idx" ON "AdminPasswordResetToken"("adminUserId", "usedAt");

-- CreateIndex
CREATE INDEX "AdminPasswordResetToken_expiresAt_idx" ON "AdminPasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_key_key" ON "ApiKey"("key");

-- CreateIndex
CREATE INDEX "ApiKey_key_idx" ON "ApiKey"("key");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "RecurringPaymentSchedule_userId_idx" ON "RecurringPaymentSchedule"("userId");

-- CreateIndex
CREATE INDEX "RecurringPaymentSchedule_status_nextRunAt_idx" ON "RecurringPaymentSchedule"("status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringPaymentRun_stellarTxId_key" ON "RecurringPaymentRun"("stellarTxId");

-- CreateIndex
CREATE INDEX "RecurringPaymentRun_scheduleId_idx" ON "RecurringPaymentRun"("scheduleId");

-- CreateIndex
CREATE INDEX "RecurringPaymentRun_status_idx" ON "RecurringPaymentRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_externalId_key" ON "Transaction"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_stellarTxId_key" ON "Transaction"("stellarTxId");

-- CreateIndex
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "FeeReport_reportType_idx" ON "FeeReport"("reportType");

-- CreateIndex
CREATE INDEX "FeeReport_startDate_idx" ON "FeeReport"("startDate");

-- CreateIndex
CREATE INDEX "FeeReport_endDate_idx" ON "FeeReport"("endDate");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_transactionId_idx" ON "Notification"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "KycCustomer_userId_key" ON "KycCustomer"("userId");

-- CreateIndex
CREATE INDEX "KycCustomer_provider_providerRef_idx" ON "KycCustomer"("provider", "providerRef");

-- CreateIndex
CREATE INDEX "KycCustomer_userId_idx" ON "KycCustomer"("userId");

-- CreateIndex
CREATE INDEX "Quote_sellAsset_idx" ON "Quote"("sellAsset");

-- CreateIndex
CREATE INDEX "Quote_buyAsset_idx" ON "Quote"("buyAsset");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_version_key" ON "SystemConfig"("version");

-- CreateIndex
CREATE INDEX "SystemConfig_isActive_idx" ON "SystemConfig"("isActive");

-- CreateIndex
CREATE INDEX "SystemConfig_createdAt_idx" ON "SystemConfig"("createdAt");

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

-- CreateIndex
CREATE UNIQUE INDEX "ContractEvent_contractEventId_key" ON "ContractEvent"("contractEventId");

-- CreateIndex
CREATE INDEX "ContractEvent_contractId_idx" ON "ContractEvent"("contractId");

-- CreateIndex
CREATE INDEX "ContractEvent_txHash_idx" ON "ContractEvent"("txHash");

-- CreateIndex
CREATE INDEX "ContractEvent_ledger_idx" ON "ContractEvent"("ledger");

-- CreateIndex
CREATE UNIQUE INDEX "MultisigTransaction_hash_key" ON "MultisigTransaction"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "MultisigTransaction_stellarTxId_key" ON "MultisigTransaction"("stellarTxId");

-- CreateIndex
CREATE UNIQUE INDEX "MultisigSignature_multisigTransactionId_signerPublicKey_key" ON "MultisigSignature"("multisigTransactionId", "signerPublicKey");

-- CreateIndex
CREATE INDEX "MultisigNotification_recipientPublicKey_readAt_idx" ON "MultisigNotification"("recipientPublicKey", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetValidationResult_assetCode_issuerPublicKey_key" ON "AssetValidationResult"("assetCode", "issuerPublicKey");

-- AddForeignKey
ALTER TABLE "AdminPasswordResetToken" ADD CONSTRAINT "AdminPasswordResetToken_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPaymentSchedule" ADD CONSTRAINT "RecurringPaymentSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPaymentRun" ADD CONSTRAINT "RecurringPaymentRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RecurringPaymentSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycCustomer" ADD CONSTRAINT "KycCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultisigSignature" ADD CONSTRAINT "MultisigSignature_multisigTransactionId_fkey" FOREIGN KEY ("multisigTransactionId") REFERENCES "MultisigTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultisigNotification" ADD CONSTRAINT "MultisigNotification_multisigTransactionId_fkey" FOREIGN KEY ("multisigTransactionId") REFERENCES "MultisigTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

