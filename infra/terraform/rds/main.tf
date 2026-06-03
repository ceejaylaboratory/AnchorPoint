# =============================================================================
# AWS RDS PostgreSQL Module - Issue #413
# =============================================================================
# This Terraform module provisions an AWS RDS PostgreSQL instance for the AnchorPoint
# project. It includes Multi-AZ deployment, automated backups, encryption at rest,
# and secure access via security groups. Sensitive outputs are stored in AWS Secrets
# Manager to avoid exposing them in terraform state.
# =============================================================================

# -----------------------------------------------------------------------------
# Terraform Required Providers
# Specifies the required AWS provider version for stability and compatibility.
# -----------------------------------------------------------------------------
terraform {
  required_version = ">= 1.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0, < 6.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0.0, < 4.0.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Data Sources
# Retrieves existing VPC and subnet information for secure network configuration.
# -----------------------------------------------------------------------------

# Get the default VPC for the region
data "aws_vpc" "default" {
  default = true
}

# Get private subnets in the VPC for secure database placement
data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  tags = {
    Tier = "private"
  }
}

# -----------------------------------------------------------------------------
# Random Password Generation
# Generates a secure random password for the database when not provided.
# This ensures a strong password is used without manual intervention.
# -----------------------------------------------------------------------------
resource "random_password" "db_password" {
  length  = 32
  special = true
  upper   = true
  lower   = true
  numeric = true

  # Override with provided password if specified
  override_characters = var.db_password_override
}

# -----------------------------------------------------------------------------
# Security Group for RDS
# Restricts database access to only application and worker subnets.
# Uses least-privilege principle for network access.
# -----------------------------------------------------------------------------
resource "aws_security_group" "rds_sg" {
  name        = "${var.project_name}-rds-sg-${var.environment}"
  description = "Security group for ${var.project_name} RDS PostgreSQL instance (${var.environment})"
  vpc_id      = data.aws_vpc.default.id

  # Allow inbound PostgreSQL traffic from app subnet
  ingress {
    description = "PostgreSQL access from application subnets"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    # Restrict to specific subnets for security
    cidr_blocks = var.app_subnet_cidrs
  }

  # Allow inbound PostgreSQL traffic from worker subnet
  ingress {
    description = "PostgreSQL access from worker subnets"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.worker_subnet_cidrs
  }

  # Allow all outbound traffic (required for updates and monitoring)
  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-rds-sg-${var.environment}"
    Environment = var.environment
    Project     = var.project_name
  }
}

# -----------------------------------------------------------------------------
# Primary RDS Subnet Group
# Creates a subnet group for Multi-AZ deployment across availability zones.
# Ensures high availability by spreading instances across AZs.
# -----------------------------------------------------------------------------
resource "aws_db_subnet_group" "rds_subnet_group" {
  name        = "${var.project_name}-rds-subnet-${var.environment}"
  description = "Subnet group for ${var.project_name} RDS PostgreSQL (${var.environment})"
  subnet_ids  = data.aws_subnets.private.ids

  tags = {
    Name        = "${var.project_name}-rds-subnet-${var.environment}"
    Environment = var.environment
    Project     = var.project_name
  }
}

# -----------------------------------------------------------------------------
# RDS PostgreSQL Instance
# The main database instance with production-grade configuration including:
# - Multi-AZ for high availability
# - Automated backups for disaster recovery
# - Encryption at rest for data protection
# -----------------------------------------------------------------------------
resource "aws_db_instance" "postgres" {
  # Database identifier - must be unique within the account
  identifier = "${var.project_name}-${var.environment}"

  # Engine configuration
  engine         = "postgres"
  engine_version = var.postgres_engine_version
  instance_class = var.db_instance_class

  # Database credentials
  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result
  port     = 5432

  # Storage configuration
  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  # Multi-AZ deployment for high availability
  multi_az = true

  # Automated backup configuration
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  skip_final_snapshot    = false
  final_snapshot_identifier = "${var.project_name}-${var.environment}-final-snapshot"

  # Maintenance window (low traffic hours)
  maintenance_window = "sun:05:00-sun:06:00"

  # Network configuration
  db_subnet_group_name = aws_db_subnet_group.rds_subnet_group.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  publicly_accessible  = false

  # Parameter group for custom settings
  parameter_group_name = aws_db_parameter_group.postgres.name

  # Monitoring and logging
  enabled_cloudwatch_logs_exports = ["postgresql"]
  monitoring_interval            = 60
  monitoring_role_arn            = aws_iam_role.rds_monitoring.arn

  # Performance insights
  performance_insights_enabled = true
  performance_insights_retention_period = 7

  # Apply immediately (use cautiously in production)
  apply_immediately = var.apply_immediately

  tags = {
    Name        = "${var.project_name}-rds-${var.environment}"
    Environment = var.environment
    Project     = var.project_name
    Component   = "database"
  }
}

# -----------------------------------------------------------------------------
# DB Parameter Group
# Custom parameter group for PostgreSQL optimizations.
# -----------------------------------------------------------------------------
resource "aws_db_parameter_group" "postgres" {
  name        = "${var.project_name}-postgres-params-${var.environment}"
  family      = "postgres15"
  description = "Custom parameter group for ${var.project_name} RDS PostgreSQL (${var.environment})"

  # Performance parameters
  parameter {
    name  = "shared_buffers"
    value = "{DBInstanceClassMemory/4096}"
  }

  parameter {
    name  = "max_connections"
    value = "100"
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# -----------------------------------------------------------------------------
# IAM Role for Enhanced Monitoring
# Allows RDS to write monitoring metrics to CloudWatch.
# -----------------------------------------------------------------------------
resource "aws_iam_role" "rds_monitoring" {
  name = "${var.project_name}-rds-monitoring-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# -----------------------------------------------------------------------------
# Secrets Manager - Store Sensitive Credentials
# Stores database password and endpoint securely, avoiding exposure in tfstate.
# This is the recommended approach for handling sensitive data.
# -----------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "db_credentials" {
  name = "${var.project_name}/${var.environment}/db-credentials"

  description = "Database credentials for ${var.project_name} ${var.environment} environment"

  tags = {
    Environment = var.environment
    Project     = var.project_name
    Component   = "database"
  }
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id

  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_password.result
    endpoint = aws_db_instance.postgres.endpoint
    port     = aws_db_instance.postgres.port
    database = var.db_name
    db_instance_identifier = aws_db_instance.postgres.identifier
  })
}

# =============================================================================
# Manual QA Steps:
# =============================================================================
# 1. Initialize Terraform:
#    cd infra/terraform/rds
#    terraform init
#
# 2. Validate configuration:
#    terraform validate
#
# 3. Review execution plan:
#    terraform plan -out=tfplan
#
# 4. Apply the configuration:
#    terraform apply tfplan
#
# 5. Verify connection (from a pod in allowed subnet):
#    PGPASSWORD=$(terraform output -raw db_password) psql \
#      -h $(terraform output -raw db_endpoint) \
#      -U $(terraform output -raw db_username) \
#      -d $(terraform output -raw db_name)
#
# 6. Check Secrets Manager:
#    aws secretsmanager get-secret-value \
#      --secret-id $(terraform output -raw secrets_manager_secret_name)
#
# 7. Cleanup (if needed):
#    terraform destroy -auto-approve
# =============================================================================