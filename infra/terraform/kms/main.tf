# ==============================================================================
# AWS KMS Provisioning for AnchorPoint — Issue #412
# ==============================================================================
# Provisions a symmetric CMK (AES-256) that encrypts Stellar provider signing
# keypairs used in SEP-10 authentication and SEP-24 transaction flows.
#
# Security invariant (ref: IMPLEMENTATION_SUMMARY.md):
#   Provider private keys are NEVER written to any persistent store in plaintext.
#   This key is the single encryption root for all Stellar signing key material.
#
# WARNING: Destroying this key without first rotating the Stellar signing keypair
#          will permanently break SEP-10 authentication for the anchor.
#          Always rotate the keypair BEFORE scheduling key deletion.
# ==============================================================================

terraform {
  required_version = ">= 1.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0, < 6.0.0"
    }
  }
}

# ------------------------------------------------------------------------------
# Data Sources
# ------------------------------------------------------------------------------

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ------------------------------------------------------------------------------
# KMS Key Policy
#
# Four explicit principal groups — no wildcard principals:
#
#   1. Root account            — mandatory AWS requirement, full admin
#   2. key_administrator_arns  — DevOps/CI lifecycle management only
#   3. task_role_arn           — AnchorPoint ECS/EKS task role: encrypt/decrypt
#                                and data-key generation only. This is the sole
#                                workload principal permitted to use the key for
#                                envelope encryption and secret hydration.
#   4. CloudTrail (optional)   — log delivery encryption
# ------------------------------------------------------------------------------

data "aws_iam_policy_document" "kms_policy" {

  # ── 1. Root admin (mandatory AWS requirement) ────────────────────────────────
  statement {
    sid    = "EnableRootAdministration"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }

    actions   = ["kms:*"]
    resources = ["*"]
  }

  # ── 2. Key administrators (DevOps / CI roles) ────────────────────────────────
  # Can manage key lifecycle (rotate, disable, delete) but cannot encrypt/decrypt.
  dynamic "statement" {
    for_each = length(var.key_administrator_arns) > 0 ? [1] : []

    content {
      sid    = "AllowKeyAdministrators"
      effect = "Allow"

      principals {
        type        = "AWS"
        identifiers = var.key_administrator_arns
      }

      actions = [
        "kms:Create*",
        "kms:Describe*",
        "kms:Enable*",
        "kms:List*",
        "kms:Put*",
        "kms:Update*",
        "kms:Revoke*",
        "kms:Disable*",
        "kms:Get*",
        "kms:Delete*",
        "kms:TagResource",
        "kms:UntagResource",
        "kms:ScheduleKeyDeletion",
        "kms:CancelKeyDeletion",
      ]

      resources = ["*"]
    }
  }

  # ── 3. AnchorPoint ECS/EKS task role — least-privilege usage ─────────────────
  # The AnchorPoint backend uses this to encrypt provider keys on ingestion and
  # decrypt them during SEP-10 challenge generation and SEP-24 flows, as well as
  # to generate data keys for envelope encryption and secret hydration.
  dynamic "statement" {
    for_each = var.task_role_arn != "" ? [1] : []

    content {
      sid    = "AllowAnchorPointTaskRoleUsage"
      effect = "Allow"

      principals {
        type        = "AWS"
        identifiers = [var.task_role_arn]
      }

      actions = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey",
      ]

      resources = ["*"]
    }
  }

  # ── 4. CloudTrail log encryption (optional) ──────────────────────────────────
  dynamic "statement" {
    for_each = var.enable_cloudtrail_encryption ? [1] : []

    content {
      sid    = "AllowCloudTrailEncryption"
      effect = "Allow"

      principals {
        type        = "Service"
        identifiers = ["cloudtrail.amazonaws.com"]
      }

      actions = [
        "kms:GenerateDataKey*",
        "kms:DescribeKey",
      ]

      resources = ["*"]

      condition {
        test     = "StringLike"
        variable = "kms:EncryptionContext:aws:cloudtrail:arn"
        values   = ["arn:aws:cloudtrail:*:${data.aws_caller_identity.current.account_id}:trail/*"]
      }
    }
  }
}

# ------------------------------------------------------------------------------
# KMS Customer Managed Key
#
# Symmetric AES-256 key — matches the SYMMETRIC_DEFAULT algorithm expected by
# @aws-sdk/client-kms v3 used in key-management.service.ts.
# ------------------------------------------------------------------------------

resource "aws_kms_key" "anchorpoint_stellar_keys" {
  description              = var.description
  key_usage                = "ENCRYPT_DECRYPT"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"

  # Automatically rotates the backing key material every ~365 days.
  # Key IDs and aliases remain stable — no application config change required.
  enable_key_rotation = true

  # 10-day deletion window for testnet: long enough to recover from an
  # accidental destroy, short enough for teardown cycles.
  # For mainnet, raise this to 30 and add prevent_destroy = true.
  deletion_window_in_days = var.deletion_window_in_days

  multi_region = var.multi_region

  policy = data.aws_iam_policy_document.kms_policy.json

  tags = {
    Name        = "anchorpoint-stellar-keys-${var.environment}"
    Environment = var.environment
    Project     = "AnchorPoint"
  }
}

# ------------------------------------------------------------------------------
# KMS Alias
#
# Application code references the alias, not the raw key ID. This means key
# rotation or replacement is transparent to the backend service.
# Format: alias/anchorpoint-<environment>
# e.g.    alias/anchorpoint-production
# ------------------------------------------------------------------------------

resource "aws_kms_alias" "anchorpoint_stellar_keys" {
  name          = "alias/anchorpoint-${var.environment}"
  target_key_id = aws_kms_key.anchorpoint_stellar_keys.key_id
}

# ------------------------------------------------------------------------------
# SSM Parameter Store — AWS_KMS_KEY_ARN
#
# Writes the provisioned key ARN into SSM so the backend reads it automatically
# at startup via KEY_MANAGEMENT_BACKEND=aws-kms in key-management.service.ts.
# Eliminates manual copy-paste from terraform output into .env files.
#
# Path: /anchorpoint/<environment>/AWS_KMS_KEY_ARN
# ------------------------------------------------------------------------------

resource "aws_ssm_parameter" "kms_key_arn" {
  name        = "/anchorpoint/${var.environment}/AWS_KMS_KEY_ARN"
  type        = "String"
  value       = aws_kms_key.anchorpoint_stellar_keys.arn
  description = "KMS key ARN for AnchorPoint ${var.environment} — maps to AWS_KMS_KEY_ARN in backend config"

  tags = {
    Environment = var.environment
    Project     = "AnchorPoint"
  }
}
