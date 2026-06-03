# =============================================================================
# AWS RDS PostgreSQL Variables - Issue #413
# =============================================================================
# This file defines all configurable variables for the RDS PostgreSQL module.
# All values can be overridden via terraform.tfvars or environment variables.
# =============================================================================

# -----------------------------------------------------------------------------
# Required Variables
# These must be provided by the user or via terraform.tfvars
# -----------------------------------------------------------------------------

variable "project_name" {
  description = "Name of the project (used for resource naming)"
  type        = string
  default     = "anchorpoint"
}

variable "environment" {
  description = "Deployment environment (testnet, mainnet, staging, production)"
  type        = string
  default     = "testnet"
}

variable "region" {
  description = "AWS region for the RDS instance"
  type        = string
  default     = "us-east-1"
}

# -----------------------------------------------------------------------------
# Database Configuration Variables
# Control the database instance specifications and credentials
# -----------------------------------------------------------------------------

variable "db_instance_class" {
  description = "RDS instance class (e.g., db.t3.micro, db.t3.small, db.t3.medium)"
  type        = string
  default     = "db.t3.micro"
}

variable "postgres_engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "15.4"
}

variable "db_name" {
  description = "Initial database name"
  type        = string
  default     = "anchorpoint"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "anchorpoint_admin"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,127}$", var.db_username))
    error_message = "Database username must start with a letter and contain only alphanumeric characters or underscores."
  }
}

# -----------------------------------------------------------------------------
# Storage Configuration Variables
# Control storage allocation and growth settings
# -----------------------------------------------------------------------------

variable "allocated_storage" {
  description = "Initial allocated storage in GiB"
  type        = number
  default     = 20

  validation {
    condition     = var.allocated_storage >= 20 && var.allocated_storage <= 1000
    error_message = "Allocated storage must be between 20 and 1000 GiB."
  }
}

variable "max_allocated_storage" {
  description = "Maximum allocated storage for autoscaling (0 to disable)"
  type        = number
  default     = 100

  validation {
    condition     = var.max_allocated_storage >= var.allocated_storage
    error_message = "Max allocated storage must be greater than or equal to allocated storage."
  }
}

# -----------------------------------------------------------------------------
# Network Configuration Variables
# Define network access restrictions for security
# -----------------------------------------------------------------------------

variable "app_subnet_cidrs" {
  description = "List of CIDR blocks for application subnets that need database access"
  type        = list(string)
  default     = []
}

variable "worker_subnet_cidrs" {
  description = "List of CIDR blocks for worker subnets that need database access"
  type        = list(string)
  default     = []
}

variable "vpc_id" {
  description = "VPC ID for the RDS instance (defaults to default VPC)"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Optional Override Variables
# Allow providing values instead of auto-generated ones
# -----------------------------------------------------------------------------

variable "db_password_override" {
  description = "Override the auto-generated database password (leave empty for random generation)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "apply_immediately" {
  description = "Whether to apply changes immediately or during next maintenance window"
  type        = bool
  default     = false
}

# =============================================================================
# Manual QA Steps for Variables:
# =============================================================================
# 1. Copy example file and customize:
#    cp terraform.tfvars.example terraform.tfvars
#
# 2. Edit terraform.tfvars with your values:
#    editor terraform.tfvars
#
# 3. Validate variables are correctly set:
#    terraform validate
#
# 4. Check which variables are required:
#    terraform plan
# =============================================================================