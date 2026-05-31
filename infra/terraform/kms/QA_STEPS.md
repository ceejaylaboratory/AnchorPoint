# KMS Manual QA Steps — Issue #412

## Pre-requisites
- AWS CLI configured with sufficient permissions
- Terraform >= 1.0.0 installed
- `checkov` installed (`pip install checkov`)

---

## Step 1 — Initialize and validate

```bash
cd infra/terraform/kms

terraform init
terraform fmt -check
terraform validate
```

---

## Step 2 — Security scan

```bash
checkov -d . --framework terraform
```

Expected passes:
- `CKV_AWS_7` — Key rotation enabled
- `CKV_AWS_109` — Key policy does not use wildcard principal
- `CKV_AWS_149` — No plaintext secrets in config

---

## Step 3 — Plan

```bash
cp terraform.tfvars.example terraform.tfvars
# Fill in real ARNs in terraform.tfvars

terraform plan -var-file=terraform.tfvars
```

Expected output:
```
Plan: 3 to add, 0 to change, 0 to destroy.
  + aws_kms_key.anchorpoint_stellar_keys
  + aws_kms_alias.anchorpoint_stellar_keys
  + aws_ssm_parameter.kms_key_arn
```

---

## Step 4 — Apply

```bash
terraform apply -var-file=terraform.tfvars
```

---

## Step 5 — Verify key rotation is enabled

```bash
KEY_ID=$(terraform output -raw key_id)

aws kms get-key-rotation-status --key-id "$KEY_ID"
```

Expected:
```json
{ "KeyRotationEnabled": true }
```

---

## Step 6 — Encrypt/decrypt round-trip

```bash
ALIAS=$(terraform output -raw alias_name)

# Encrypt a test string
CIPHER=$(aws kms encrypt \
  --key-id "$ALIAS" \
  --plaintext "anchorpoint-test" \
  --query CiphertextBlob \
  --output text)

# Decrypt it back — should return "anchorpoint-test"
aws kms decrypt \
  --ciphertext-blob fileb://<(echo "$CIPHER" | base64 -d) \
  --query Plaintext \
  --output text | base64 -d
```

---

## Step 7 — Verify SSM parameter was written

```bash
SSM_PATH=$(terraform output -raw ssm_parameter_name)

aws ssm get-parameter --name "$SSM_PATH" --query Parameter.Value --output text
```

Expected: the full KMS key ARN.

---

## Step 8 — Teardown (testnet only)

```bash
terraform destroy -var-file=terraform.tfvars
# Key enters 10-day pending-deletion window.
```
