-- CreateIndex
CREATE INDEX "Transaction_userId_status_createdAt_idx" ON "Transaction"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "KycCustomer_userId_status_createdAt_idx" ON "KycCustomer"("userId", "status", "createdAt");
