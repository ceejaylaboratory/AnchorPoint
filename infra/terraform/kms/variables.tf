# ==============================================================================
# variables.tf — AnchorPoint KMS — Issue #412
# ==============================================================================

# ------------------------------------------------------------------------------
# Required
# ------------------------------------------------------------------------------

variable "environment" {
  description = "Deployment environment. Controls alias prefix and SSM path."
  type        = string

  validation {
    condition     = contains(["testnet", "staging", "mainnet"], var.environment)
    error_message = "environment must be one of: testnet, staging, mainnet."
  }
}

variable "key_alias" {
  description = <<-EOT
    Short, lowercase, hyphenated key alias.
    Combined with environment to form: alias/<environment>/<key_alias>
    Recommended value: "anchorpoint-stellar-keys"
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.key_alias))
    error_message = "key_alias must be lowercase alphanumeric with hyphens only."
  }
}

# ------------------------------------------------------------------------------
# IAM principals — key policy
# ------------------------------------------------------------------------------

variable "key_administrator_arns" {
  description = <<-EOT
    IAM ARNs (roles/users) granted key administration rights.
    Typically: DevOps admin role and CI/CD deploy role.
    These principals can rotate/disable/delete the key but NOT encrypt/decrypt.
  EOT
  type        = list(string)
  default     = []
}

variable "api_server_role_arn" {
  description = <<-EOT
    IAM role ARN attached to the AnchorPoint Node.js API runtime
    (ECS task role or EC2 instance profile).
    Granted encrypt/decrypt only — no admin rights.
  EOT
  type        = string
  default     = ""
}

variable "worker_role_arn" {
  description = <<-EOT
    IAM role ARN attached to the BullMQ worker process.
    Must be separate from api_server_role_arn — the worker runs as an
    independent process and decrypts Stellar signing keys during
    settlement and contract-call job execution.
    Granted encrypt/decrypt only — no admin rights.
  EOT
  type        = string
  default     = ""
}

# ------------------------------------------------------------------------------
# Feature flags
# ------------------------------------------------------------------------------

variable "enable_cloudtrail_encryption" {
  description = "When true, adds a key policy statement allowing CloudTrail to encrypt log delivery."
  type        = bool
  default     = false
}

variable "multi_region" {
  description = "When true, creates a multi-region primary key. Cannot be changed after creation."
  type        = bool
  default     = false
}

variable "deletion_window_in_days" {
  description = <<-EOT
    Waiting period before a scheduled key deletion takes effect (7–30 days).
    Testnet default: 10 days — long enough to recover from an accidental destroy,
    short enough for teardown cycles.
    Mainnet recommendation: 30 days.
  EOT
  type        = number
  default     = 10

  validation {
    condition     = var.deletion_window_in_days >= 7 && var.deletion_window_in_days <= 30
    error_message = "deletion_window_in_days must be between 7 and 30."
  }
}

# ------------------------------------------------------------------------------
# Metadata
# ------------------------------------------------------------------------------

variable "description" {
  description = "Human-readable description attached to the KMS key."
  type        = string
  default     = "AnchorPoint KMS CMK — encrypts Stellar provider signing keypairs"
}
