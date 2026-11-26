-- Add compound indexes for dashboard transaction queries
-- These indexes optimize filtering by (stellarAccountId, status, createdAt) and (assetCode, createdAt)

-- Index for filtering transactions by user account, status, and creation date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_user_status_created
ON "Transaction" ("userId", "status", "createdAt" DESC);

-- Index for filtering transactions by asset code and creation date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_asset_created
ON "Transaction" ("assetCode", "createdAt" DESC);

-- Index for SEP-31 specific queries by asset and date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_type_asset_created
ON "Transaction" ("type", "assetCode", "createdAt" DESC);

-- Index for status-based dashboard queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_status_updated
ON "Transaction" ("status", "updatedAt" DESC);