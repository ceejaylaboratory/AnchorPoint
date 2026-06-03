# Implementation Notes - Issues #416, #413, #424, #419

## Summary

This document summarizes the DevOps infrastructure implementations completed for the AnchorPoint project.

---

## Task 1 - Issue #416: Kubernetes Worker Deployment Manifest

**File Location:** `infra/k8s/workers/deployment.yaml`

### What Was Implemented

- **ConfigMap**: Non-sensitive configuration (`LOG_LEVEL`, `QUEUE_CONCURRENCY`, `STELLAR_NETWORK`, `REQUEST_TIMEOUT_MS`, `METRICS_PORT`)
- **Secret**: Sensitive credentials template (empty values - must be populated via `kubectl create secret` or external secret operators)
- **Deployment**: 
  - RollingUpdate strategy with maxSurge/maxUnavailable
  - Resource requests (100m CPU, 128Mi memory) and limits (500m CPU, 512Mi memory)
  - Liveness probe (`/health` on port 3002, 30s delay, 10s period)
  - Readiness probe (`/health` on port 3002, 5s delay, 5s period)
  - Security context (non-root user, no privilege escalation, read-only root filesystem)
- **Service**: ClusterIP service exposing HTTP (3002) and metrics (9464) ports

### Labels Applied
- `app: anchorpoint`
- `component: worker`
- `environment: testnet`

### Manual QA Steps
```bash
# 1. Validate YAML syntax
yamllint infra/k8s/workers/deployment.yaml

# 2. Create namespace
kubectl create namespace anchorpoint-testnet --dry-run=client -o yaml | kubectl apply -f -

# 3. Create secrets (replace with actual values)
kubectl create secret generic worker-secrets -n anchorpoint-testnet \
  --from-literal=REDIS_URL='redis://:password@redis:6379' \
  --from-literal=DATABASE_URL='postgresql://...' \
  --from-literal=STELLAR_PASSPHRASE='Test SDF Network ; September 2015' \
  --from-literal=STELLAR_DEPLOYER_SECRET='S...' \
  --from-literal=JWT_SECRET='...'

# 4. Deploy
kubectl apply -f infra/k8s/workers/deployment.yaml -n anchorpoint-testnet

# 5. Verify
kubectl get pods -n anchorpoint-testnet -l app=anchorpoint,component=worker
kubectl get svc -n anchorpoint-testnet anchorpoint-worker-svc
kubectl logs -n anchorpoint-testnet -l app=anchorpoint,component=worker
```

---

## Task 2 - Issue #413: Terraform AWS RDS PostgreSQL

**File Location:** `infra/terraform/rds/`

### Files Created

| File | Description |
|------|-------------|
| `main.tf` | RDS instance, security group, subnet group, Secrets Manager integration |
| `variables.tf` | All configurable parameters with validation |
| `outputs.tf` | Non-sensitive outputs and Secrets Manager references |
| `terraform.tfvars.example` | Example configuration (no secrets) |

### Features Implemented

- **Variables**: `project_name`, `environment`, `region`, `db_instance_class`, `db_name`, `db_username`, `allocated_storage`, `max_allocated_storage`, subnet CIDRs
- **Multi-AZ**: Enabled by default for high availability
- **Automated Backups**: 7-day retention, daily backup window
- **Encryption**: `storage_encrypted = true` for data at rest
- **Security Groups**: Restricted to app/worker subnet CIDRs only
- **Secrets Manager**: Password and endpoint stored securely, never in tfstate
- **Monitoring**: CloudWatch logs, Performance Insights enabled

### Manual QA Steps
```bash
# 1. Initialize
cd infra/terraform/rds
terraform init

# 2. Validate
terraform validate

# 3. Plan
terraform plan -out=tfplan

# 4. Apply
terraform apply tfplan

# 5. Verify RDS
aws rds describe-db-instances --db-instance-identifier anchorpoint-testnet

# 6. Retrieve credentials from Secrets Manager
aws secretsmanager get-secret-value --secret-id anchorpoint/testnet/db-credentials

# 7. Test database connection
psql -h $(terraform output -raw db_endpoint) -U anchorpoint_admin -d anchorpoint

# 8. Cleanup
terraform destroy -auto-approve
```

---

## Task 3 - Issue #424: Soroban Testnet Deployment Script

**File Location:** `scripts/deploy-soroban-testnet.sh`

### Features Implemented

- **Environment Variables**: `SOROBAN_NETWORK_PASSPHRASE`, `SOROBAN_RPC_URL`, `SOROBAN_DEPLOYER_SECRET`
- **Dry-Run Mode**: `--dry-run` flag validates prerequisites without deploying
- **Contract Build**: Builds WASM for all contracts in `./contracts/`
- **Deployment**: Uses `soroban contract deploy` with persistent durability
- **Output**: Saves deployed contract IDs to `deployed-contracts.json`
- **Error Handling**: `set -euo pipefail`, logging, exit on failure

### Manual QA Steps
```bash
# 1. Set environment variables
export SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
export SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"
export SOROBAN_DEPLOYER_SECRET="S..."

# 2. Validate prerequisites (dry-run)
./scripts/deploy-soroban-testnet.sh --dry-run

# 3. Run deployment
./scripts/deploy-soroban-testnet.sh

# 4. Verify output file
cat deployed-contracts.json

# 5. Check contracts on explorer
curl "https://stellar.expert/explorer/soroban.json?$CONTRACT_ID"
```

---

## Task 4 - Issue #419: Cert-Manager Let's Encrypt TLS

**File Location:** `infra/k8s/cert-manager/`

### Files Created

| File | Description |
|------|-------------|
| `cert-manager-values.yaml` | Helm values for cert-manager installation |
| `cluster-issuer.yaml` | Let's Encrypt staging ClusterIssuer (ACME HTTP-01) |
| `cluster-issuer-prod.yaml` | Let's Encrypt production ClusterIssuer |
| `certificates.yaml` | Certificate resources for all hostnames |
| `ingress-tls-annotations.yaml` | Annotations reference for Ingress TLS |
| `README.md` | Documentation and QA steps |

### Features Implemented

- **Staging Issuer**: For testing without production rate limits
- **Production Issuer**: Ready for live traffic (commented switch instructions)
- **HTTP-01 Challenge**: Works with NGINX Ingress Controller
- **Certificates**: API, worker/metrics, dashboard, and soroban endpoints
- **HSTS**: Security headers included in annotations
- **90-day certificates**: With 15-day renewal window

### Manual QA Steps
```bash
# 1. Add Helm repo and install cert-manager
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  -n cert-manager --create-namespace \
  -f infra/k8s/cert-manager/cert-manager-values.yaml

# 2. Apply ClusterIssuer
kubectl apply -f infra/k8s/cert-manager/cluster-issuer.yaml

# 3. Apply Certificates
kubectl apply -f infra/k8s/cert-manager/certificates.yaml

# 4. Check certificate status
kubectl get certificates -n anchorpoint-testnet

# 5. Check cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager

# 6. Verify HTTPS
curl -v https://api.anchorpoint-testnet.example.com

# 7. Switch to production (after testing)
# Update issuerRef.name to 'anchorpoint-prod-issuer' in certificates.yaml
```

---

## Security Verification

All files have been reviewed to ensure:

- ✅ No hardcoded secrets, passwords, or credentials in any file
- ✅ All sensitive values use environment variables or Kubernetes secrets
- ✅ Terraform uses Secrets Manager instead of exposing in tfstate
- ✅ Shell script validates all required env vars before running
- ✅ Kubernetes secrets are empty placeholders (must be created separately)

---

## Lint and Validation Commands

```bash
# YAML linting (install yamllint if needed)
yamllint infra/k8s/workers/deployment.yaml
yamllint infra/k8s/cert-manager/*.yaml

# Shell linting (install shellcheck if needed)
shellcheck scripts/deploy-soroban-testnet.sh

# Terraform validation
terraform -chdir=infra/terraform/rds validate

# Kubernetes dry-run (requires kubectl)
kubectl apply --dry-run=client -f infra/k8s/workers/deployment.yaml
```