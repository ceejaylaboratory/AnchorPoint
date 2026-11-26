-- Rollback: Remove compound indexes for transaction queries
DROP INDEX IF EXISTS idx_transaction_user_status_created;
DROP INDEX IF EXISTS idx_transaction_asset_created;
DROP INDEX IF EXISTS idx_transaction_type_asset_created;
DROP INDEX IF EXISTS idx_transaction_status_updated;