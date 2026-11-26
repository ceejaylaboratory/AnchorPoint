-- Add composite indexes for dashboard transaction queries
-- Index for filtering by (stellarAccountId, status, createdAt) - covers user transaction history views
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_user_status_created ON "Transaction" ("userId", "status" DESC, "createdAt" DESC);

-- Index for filtering by (assetCode, createdAt) - covers asset-specific transaction views
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_asset_created ON "Transaction" ("assetCode", "createdAt" DESC);

-- Index for combined status + asset queries (common dashboard filter combination)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_status_asset_created ON "Transaction" ("status", "assetCode", "createdAt" DESC);