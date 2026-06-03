# =============================================================================
# AWS RDS PostgreSQL Outputs - Issue #413
# =============================================================================
# This file defines outputs for the RDS PostgreSQL module.
# Sensitive values are stored in AWS Secrets Manager instead of being output here.
# =============================================================================

# -----------------------------------------------------------------------------
# Non-Sensitive Outputs
# These can be safely output without security concerns
# -----------------------------------------------------------------------------

output "db_endpoint" {
  description = "The connection endpoint for the RDS PostgreSQL instance"
  value       = aws_db_instance.postgres.endpoint
}

output "db_port" {
  description = "The port the RDS instance is listening on"
  value       = aws_db_instance.postgres.port
}

output "db_name" {
  description = "The name of the initial database"
  value       = aws_db_instance.postgres.dbname
}

output "db_username" {
  description = "The master username for the database"
  value       = aws_db_instance.postgres.username
}

output "db_instance_identifier" {
  description = "The instance identifier for the RDS instance"
  value       = aws_db_instance.postgres.identifier
}

output "db_instance_class" {
  description = "The instance class of the RDS instance"
  value       = aws_db_instance.postgres.instance_class
}

output "db_status" {
  description = "The current status of the RDS instance"
  value       = aws_db_instance.postgres.status
}

output "db_arn" {
  description = "The ARN of the RDS instance"
  value       = aws_db_instance.postgres.arn
}

output "security_group_id" {
  description = "The security group ID for the RDS instance"
  value       = aws_security_group.rds_sg.id
}

# -----------------------------------------------------------------------------
# Secrets Manager Outputs (References Only)
# These outputs provide the secret ARNs - values must be retrieved securely
# Secrets are NOT output in plaintext to avoid exposure in logs/state
# -----------------------------------------------------------------------------

output "secrets_manager_secret_arn" {
  description = "ARN of the Secrets Manager secret containing database credentials"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "secrets_manager_secret_name" {
  description = "Name of the Secrets Manager secret containing database credentials"
  value       = aws_secretsmanager_secret.db_credentials.name
}

# -----------------------------------------------------------------------------
# Connection URL Helper
# Helper output that constructs the connection URL (password must be retrieved separately)
# -----------------------------------------------------------------------------
output "database_url_template" {
  description = "Template for DATABASE_URL connection string (retrieve password via Secrets Manager)"
  value       = "postgresql://${var.db_username}:<password>@${aws_db_instance.postgres.endpoint}:${aws_db_instance.postgres.port}/${var.db_name}"
}

# =============================================================================
# Manual QA Steps for Outputs:
# =============================================================================
# 1. After deployment, get endpoint:
#    terraform output db_endpoint
#
# 2. Get all non-sensitive outputs:
#    terraform output
#
# 3. Retrieve password securely from Secrets Manager (never via terraform output):
#    aws secretsmanager get-secret-value \
#      --secret-id $(terraform output -raw secrets_manager_secret_name) \
#      --query SecretString \
#      --output json | jq -r '.password'
#
# 4. Test database connection:
#    PGPASSWORD=$(aws secretsmanager get-secret-value \
#      --secret-id $(terraform output -raw secrets_manager_secret_name) \
#      --query SecretString \
#      --output json | jq -r '.password') \
#    psql -h $(terraform output -raw db_endpoint) \
#      -U $(terraform output -raw db_username) \
#      -d $(terraform output -raw db_name) \
#      -c "SELECT version();"
# =============================================================================