-- CreateTable
CREATE TABLE "ContractEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "ledgerClosedAt" DATETIME NOT NULL,
    "txHash" TEXT NOT NULL,
    "contractEventId" TEXT NOT NULL,
    "topics" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MultisigTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "envelopeXdr" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "creatorPublicKey" TEXT NOT NULL,
    "requiredSigners" JSONB NOT NULL,
    "threshold" INTEGER NOT NULL,
    "currentSignatures" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "memo" TEXT,
    "expiresAt" DATETIME,
    "submittedAt" DATETIME,
    "stellarTxId" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MultisigSignature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "multisigTransactionId" TEXT NOT NULL,
    "signerPublicKey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MultisigSignature_multisigTransactionId_fkey" FOREIGN KEY ("multisigTransactionId") REFERENCES "MultisigTransaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MultisigNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "multisigTransactionId" TEXT NOT NULL,
    "recipientPublicKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" DATETIME,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MultisigNotification_multisigTransactionId_fkey" FOREIGN KEY ("multisigTransactionId") REFERENCES "MultisigTransaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetValidationResult" (
    "assetCode" TEXT NOT NULL,
    "issuerPublicKey" TEXT NOT NULL,
    "homeDomain" TEXT,
    "complianceStatus" TEXT NOT NULL,
    "messages" TEXT NOT NULL,
    "rawToml" TEXT,
    "lastCrawledAt" DATETIME NOT NULL,

    PRIMARY KEY ("assetCode", "issuerPublicKey")
);

-- CreateTable
CREATE TABLE "CrawlJobRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "totalAssets" INTEGER NOT NULL,
    "compliantCount" INTEGER NOT NULL,
    "nonCompliantCount" INTEGER NOT NULL,
    "suspiciousCount" INTEGER NOT NULL
);

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
