# ==============================================================================
# outputs.tf — AnchorPoint KMS — Issue #412
# ==============================================================================

output "key_id" {
  description = "The globally unique identifier of the KMS key. Safe to log."
  value       = aws_kms_key.anchorpoint_stellar_keys.key_id
}

output "key_arn" {
  description = "The ARN of the KMS key. Use this in IAM policies and SDK calls."
  value       = aws_kms_key.anchorpoint_stellar_keys.arn
}

output "alias_name" {
  description = "The full alias name (e.g. alias/testnet/anchorpoint-stellar-keys). Reference this in backend config instead of the raw key ARN."
  value       = aws_kms_alias.anchorpoint_stellar_keys.name
}

output "alias_arn" {
  description = "The ARN of the KMS alias."
  value       = aws_kms_alias.anchorpoint_stellar_keys.arn
}

output "ssm_parameter_name" {
  description = "SSM parameter path where AWS_KMS_KEY_ARN is stored for backend consumption."
  value       = aws_ssm_parameter.kms_key_arn.name
}
