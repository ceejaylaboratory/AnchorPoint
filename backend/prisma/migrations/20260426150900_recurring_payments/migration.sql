-- CreateTable
CREATE TABLE "RecurringPaymentSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" DATETIME NOT NULL,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurringPaymentSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecurringPaymentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "stellarTxId" TEXT,
    "error" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurringPaymentRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RecurringPaymentSchedule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
