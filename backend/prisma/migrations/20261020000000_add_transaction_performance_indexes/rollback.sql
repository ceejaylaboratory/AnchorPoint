-- Rollback: Remove composite indexes added for transaction performance
DROP INDEX IF EXISTS CONCURRENTLY idx_transaction_user_status_created;
DROP INDEX IF EXISTS CONCURRENTLY idx_transaction_asset_created;
DROP INDEX IF EXISTS CONCURRENTLY idx_transaction_status_asset_created;