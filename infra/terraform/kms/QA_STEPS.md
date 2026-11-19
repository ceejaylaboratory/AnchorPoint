# KMS Manual QA Steps — Issue #1681

## Pre-requisites
- AWS CLI configured with sufficient permissions
- Terraform >= 1.0.0 installed
- `tflint` installed (see https://github.com/terraform-linters/tflint)
- `checkov` installed (`pip install checkov`)

---

## Step 1 — Initialize and validate

```bash
cd infra/terraform/kms

terraform init
terraform fmt -check
terraform validate
```

Expected: `Success! The configuration is valid.`

---

## Step 2 — Lint

```bash
tflint --init
tflint
```

Expected: no errors or warnings reported for the module.

---

## Step 3 — Security scan

```bash
checkov -d . --framework terraform
```

Expected passes:
- `CKV_AWS_7` — Key rotation enabled (`enable_key_rotation = true`, annual rotation)
- `CKV_AWS_109` — Key policy does not use wildcard principal
- `CKV_AWS_149` — No plaintext secrets in config

---

## Step 4 — Verify key configuration

The module provisions:
- KMS key with **annual key rotation enabled** (`enable_key_rotation = true`)
- KMS alias **`alias/anchorpoint-production`**
- A least-privilege key policy that grants only the AnchorPoint ECS/EKS task role
  the `kms:Encrypt`, `kms:Decrypt`, and `kms:GenerateDataKey` actions

Confirm the alias resolves to the provisioned key:

```bash
aws kms describe-key --key-id alias/anchorpoint-production \
  --query KeyMetadata.Arn --output text
```

Confirm the key policy only allows the task role:

```bash
aws kms get-key-policy --key-id alias/anchorpoint-production \
  --policy-name default --output text | jq '.Statement'
```

Expected: the only `Allow` statement for key usage lists the task role ARN as
`Principal` and restricts `Action` to `kms:Encrypt`, `kms:Decrypt`, and
`kms:GenerateDataKey`. No wildcard (`"*"`) principals.

---

## Step 5 — Plan

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

## Step 6 — Apply

```bash
terraform apply -var-file=terraform.tfvars
```

---

## Step 7 — Verify key rotation is enabled

```bash
KEY_ID=$(terraform output -raw key_id)

aws kms get-key-rotation-status --key-id "$KEY_ID"
```

Expected:
```json
{ "KeyRotationEnabled": true }
```

---

## Step 8 — Encrypt/decrypt round-trip

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

## Step 9 — Verify SSM parameter was written

```bash
SSM_PATH=$(terraform output -raw ssm_parameter_name)

aws ssm get-parameter --name "$SSM_PATH" --query Parameter.Value --output text
```

Expected: the full KMS key ARN.

---

## Step 10 — Teardown (testnet only)

```bash
terraform destroy -var-file=terraform.tfvars
# Key enters 10-day pending-deletion window.
```
