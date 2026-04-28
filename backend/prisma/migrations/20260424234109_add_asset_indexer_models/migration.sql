-- CreateTable
CREATE TABLE "KycCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "extraFields" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KycCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetValidationResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetCode" TEXT NOT NULL,
    "issuerPublicKey" TEXT,
    "homeDomain" TEXT,
    "complianceStatus" TEXT NOT NULL,
    "messages" TEXT NOT NULL,
    "rawToml" TEXT,
    "lastCrawledAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CrawlJobRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "totalAssets" INTEGER NOT NULL,
    "compliantCount" INTEGER NOT NULL,
    "nonCompliantCount" INTEGER NOT NULL,
    "suspiciousCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "KycCustomer_userId_key" ON "KycCustomer"("userId");

-- CreateIndex
CREATE INDEX "KycCustomer_userId_idx" ON "KycCustomer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetValidationResult_assetCode_issuerPublicKey_key" ON "AssetValidationResult"("assetCode", "issuerPublicKey");
