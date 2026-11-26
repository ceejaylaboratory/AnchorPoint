# Disaster Recovery Runbook

Step-by-step procedures for restoring AnchorPoint after a major failure:
database corruption, ransomware, signing-key compromise or loss, Redis loss,
and loss of the primary cloud region.

Related documents: [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) (launch
gates, KMS and RDS provisioning), [`infra/terraform/rds`](../infra/terraform/rds),
[`infra/terraform/kms`](../infra/terraform/kms),
[`infra/helm/anchor-point`](../infra/helm/anchor-point),
[`scripts/backup.sh`](../scripts/backup.sh).

---

## 1. Objectives

| Objective | Target | How it is met |
|-----------|--------|---------------|
| **RTO** (Recovery Time Objective) | **< 1 hour** from incident declaration to full service | Scripted restores below; Helm redeploys; DNS TTL ≤ 60 s |
| **RPO** (Recovery Point Objective) | **< 5 minutes** of data loss | RDS automated backups with continuous WAL archiving (point-in-time restore to within ~5 minutes); `backup_retention_period = 7` days |

Stellar ledger state is the source of truth for on-chain balances; anything
lost from the database within the RPO window is reconciled from Horizon (see
§4.6).

## 2. Production topology (what we are recovering)

| Component | Production setup | Identifier |
|-----------|------------------|------------|
| API + workers | Helm chart `anchor-point` on Kubernetes | namespace `anchorpoint-prod`, release `anchor-point` |
| PostgreSQL | AWS RDS PostgreSQL, Multi-AZ, automated backups | `anchorpoint-production` (`${project_name}-${environment}`) |
| Redis | Managed Redis (cache, rate limits, BullMQ queues) | `REDIS_URL` in `anchorpoint-prod-secrets` |
| Signing-key encryption | AWS KMS symmetric CMK, rotation enabled | `alias/anchorpoint-production` |
| Application secrets | Kubernetes secret | `anchorpoint-prod-secrets` |
| Self-hosted fallback | `docker-compose.prod.yml` + nightly `scripts/backup.sh` | `postgres-data`, `redis-data` volumes |

Set these once per session before running any command:

```bash
export AWS_REGION=us-east-1              # primary region
export DR_REGION=us-west-2               # secondary region
export DB_ID=anchorpoint-production
export NS=anchorpoint-prod
export RELEASE=anchor-point
export CHART=./infra/helm/anchor-point
```

## 3. Declaring a disaster

1. On-call engineer confirms the incident and opens an incident channel.
2. Page the Incident Commander (IC) per the escalation tree (§6).
3. IC classifies the scenario (§4.1–§4.5) and starts the RTO clock.
4. **Stop writes** to prevent further damage:

   ```bash
   kubectl -n "$NS" scale deploy -l app.kubernetes.io/instance="$RELEASE" --replicas=0
   ```

5. Post a status-page update: "Investigating — deposits/withdrawals paused".

## 4. Recovery procedures

### 4.1 Database corruption or bad migration — point-in-time restore

Use when data is corrupted, deleted, or a migration went wrong. Pick a restore
time **just before** the bad change (check audit logs / deploy time).

```bash
RESTORE_TIME="2026-01-01T12:00:00Z"        # UTC, just before the incident
NEW_DB_ID="${DB_ID}-pitr-$(date -u +%Y%m%d%H%M)"

# 1. Confirm the restorable window
aws rds describe-db-instances --db-instance-identifier "$DB_ID" \
  --query 'DBInstances[0].[EarliestRestorableTime,LatestRestorableTime]'

# 2. Restore to a new instance from WAL archives
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier "$DB_ID" \
  --target-db-instance-identifier "$NEW_DB_ID" \
  --restore-time "$RESTORE_TIME" \
  --multi-az \
  --db-subnet-group-name "$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" \
      --query 'DBInstances[0].DBSubnetGroup.DBSubnetGroupName' --output text)" \
  --vpc-security-group-ids "$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" \
      --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' --output text)"

aws rds wait db-instance-available --db-instance-identifier "$NEW_DB_ID"

# 3. Get the new endpoint
NEW_HOST=$(aws rds describe-db-instances --db-instance-identifier "$NEW_DB_ID" \
  --query 'DBInstances[0].Endpoint.Address' --output text)
```

4. Spot-check the restored data (row counts on `transactions`, latest
   `created_at`) with `psql "postgresql://<user>:<pass>@$NEW_HOST:5432/anchorpoint"`.
5. Point the application at the new instance:

   ```bash
   kubectl -n "$NS" get secret anchorpoint-prod-secrets -o json \
     | jq --arg url "postgresql://<user>:<pass>@${NEW_HOST}:5432/anchorpoint" \
          '.data.DATABASE_URL = ($url | @base64)' \
     | kubectl apply -f -
   ```

6. Run migrations to confirm the schema is current:
   `kubectl -n "$NS" run migrate --rm -it --image=<backend-image> -- npx prisma migrate deploy`
7. Scale back up (§5) and reconcile the gap (§4.6).
8. Keep the old instance (renamed `${DB_ID}-corrupt`) for forensics; delete only
   after the post-mortem.

**Self-hosted (docker-compose) restore** from the latest `scripts/backup.sh`
dump:

```bash
LATEST=$(ls -1t /var/backups/anchorpoint/anchorpoint-*.sql.gz | head -1)
sha256sum -c "${LATEST}.sha256"
docker compose -f docker-compose.prod.yml stop backend-1 backend-2 backend-3
gunzip -c "$LATEST" | docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "${POSTGRES_USER:-anchorpoint}" -d "${POSTGRES_DB:-anchorpoint}"
docker compose -f docker-compose.prod.yml start backend-1 backend-2 backend-3
```

The self-hosted path is limited to the nightly dump (RPO up to 24 h) unless WAL
archiving is configured; production must use RDS.

### 4.2 Ransomware or infrastructure compromise

Assume every credential reachable from the compromised environment is burned.

1. **Isolate:** scale workloads to zero (§3), revoke the compromised IAM
   users/roles' sessions, and restrict the RDS security group to the IC's IP.

   ```bash
   aws iam list-access-keys --user-name <user>
   aws iam update-access-key --user-name <user> --access-key-id <id> --status Inactive
   ```

2. **Preserve evidence:** snapshot the current database and EBS volumes before
   changing anything.

   ```bash
   aws rds create-db-snapshot --db-instance-identifier "$DB_ID" \
     --db-snapshot-identifier "${DB_ID}-forensic-$(date -u +%Y%m%d%H%M)"
   ```

3. **Pick a clean restore point** from before the earliest indicator of
   compromise and restore it with §4.1 (or from a snapshot copied to the DR
   region, §4.5, if the primary account is untrusted).
4. **Rotate every secret** in `anchorpoint-prod-secrets` (`JWT_SECRET`,
   `SEP24_INTERACTIVE_URL_JWT_SECRET`, `WEBHOOK_SECRET`, `REDIS_URL` password,
   `DATABASE_URL` password) and the Stellar signing keys (§4.3).
5. **Rebuild** the cluster workloads from the signed image of the last known
   good release — never reuse running containers.
6. Notify security and legal (§6) for breach-notification obligations.

### 4.3 Compromised master signing key — rotation

Applies to `SIGNING_KEY` (stellar.toml / SEP-10), `ANCHOR_SECRET_KEY`,
`STELLAR_DISTRIBUTION_SECRET`, `STELLAR_FEE_BUMP_SECRET` and `RELAYER_SECRET_KEY`.

1. **Generate a new keypair** on an offline/trusted machine:

   ```bash
   stellar keys generate anchorpoint-signing-new --network mainnet
   stellar keys address anchorpoint-signing-new
   ```

2. **Encrypt it with KMS** (the key never touches disk in plaintext):

   ```bash
   aws kms encrypt --key-id alias/anchorpoint-production \
     --plaintext fileb://<(stellar keys show anchorpoint-signing-new | tr -d '\n') \
     --query CiphertextBlob --output text
   ```

3. **Re-sign accounts.** For each account the old key can sign for, add the new
   key as a signer and remove the old one in a single transaction signed by the
   remaining master/threshold signers (`set_options`: add new signer weight =
   old weight; set old signer weight `0`).
4. **Update stellar.toml** `SIGNING_KEY` to the new public key and purge any CDN
   cache so SEP-10 clients pick it up.
5. **Update the Kubernetes secret** with the new (encrypted) value and restart:

   ```bash
   kubectl -n "$NS" create secret generic anchorpoint-prod-secrets \
     --from-env-file=prod-secrets.env --dry-run=client -o yaml | kubectl apply -f -
   kubectl -n "$NS" rollout restart deploy -l app.kubernetes.io/instance="$RELEASE"
   ```

6. Invalidate outstanding SEP-10 JWTs by rotating `JWT_SECRET`.
7. Move remaining funds from any account whose master key was exposed to a
   fresh account.

### 4.4 KMS key loss or pending deletion

If the CMK behind `alias/anchorpoint-production` is disabled or scheduled for
deletion, encrypted signing keys cannot be decrypted.

```bash
KEY_ID=$(aws kms describe-key --key-id alias/anchorpoint-production --query KeyMetadata.KeyId --output text)
aws kms describe-key --key-id "$KEY_ID" --query 'KeyMetadata.[KeyState,DeletionDate]'

# Pending deletion → cancel and re-enable
aws kms cancel-key-deletion --key-id "$KEY_ID"
aws kms enable-key --key-id "$KEY_ID"
```

If the key is already deleted, its ciphertexts are unrecoverable: rotate every
signing key (§4.3) under a new CMK created with `terraform apply` in
`infra/terraform/kms`.

### 4.5 Primary region failure — failover to the secondary region

Prerequisite (steady state): automated RDS snapshots are copied to `$DR_REGION`
and a standby Kubernetes cluster exists there.

```bash
# 1. Find the most recent snapshot copy in the DR region
SNAP=$(aws rds describe-db-snapshots --region "$DR_REGION" \
  --query "reverse(sort_by(DBSnapshots[?contains(DBSnapshotIdentifier, '${DB_ID}')], &SnapshotCreateTime))[0].DBSnapshotIdentifier" \
  --output text)

# 2. Restore it (or promote a cross-region read replica if one exists:
#    aws rds promote-read-replica --region "$DR_REGION" --db-instance-identifier "${DB_ID}-replica")
aws rds restore-db-instance-from-db-snapshot --region "$DR_REGION" \
  --db-instance-identifier "${DB_ID}-dr" \
  --db-snapshot-identifier "$SNAP" --multi-az
aws rds wait db-instance-available --region "$DR_REGION" --db-instance-identifier "${DB_ID}-dr"

# 3. Make sure a KMS key with the same alias exists in the DR region
#    (multi-region replica key or `terraform apply` with region = $DR_REGION)
aws kms describe-key --region "$DR_REGION" --key-id alias/anchorpoint-production

# 4. Deploy the application to the DR cluster
kubectl config use-context <dr-cluster-context>
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NS" create secret generic anchorpoint-prod-secrets --from-env-file=prod-secrets-dr.env
helm upgrade --install "$RELEASE" "$CHART" -f "$CHART/values-prod.yaml" --namespace "$NS"
kubectl -n "$NS" rollout status deploy -l app.kubernetes.io/instance="$RELEASE" --timeout=10m

# 5. Switch DNS to the DR ingress (Route 53 example)
aws route53 change-resource-record-sets --hosted-zone-id <zone-id> \
  --change-batch file://dns-failover-to-dr.json
```

`prod-secrets-dr.env` must point `DATABASE_URL` at the DR instance,
`REDIS_URL` at the DR Redis, and `AWS_REGION` at `$DR_REGION`.

Fail back with the same steps in reverse once the primary region is healthy and
data written in the DR region has been migrated back.

### 4.6 Redis cache and queue recovery

Redis holds caches, rate-limit counters and BullMQ job queues. It is **not** a
system of record.

1. If the managed instance is recoverable, restore its latest snapshot /
   AOF backup through the provider console or CLI
   (e.g. `aws elasticache create-replication-group --snapshot-name <snapshot> ...`).
2. Otherwise provision an empty instance and update `REDIS_URL`.
3. Restart the API and workers so connections and BullMQ workers re-register:

   ```bash
   kubectl -n "$NS" rollout restart deploy -l app.kubernetes.io/instance="$RELEASE"
   ```

4. Re-enqueue in-flight work from the database: transactions in a pending
   state are picked up again by the reconciliation and contract-queue workers;
   trigger a reconciliation run if it is not scheduled within the next 5
   minutes.
5. Caches warm up on demand; expect elevated database load for ~15 minutes.

**Reconciling after any restore:** compare `transactions` rows newer than the
restore point against Horizon (`/accounts/<distribution-account>/payments`)
and re-create missing records before reopening deposits/withdrawals.

## 5. Bring service back

```bash
kubectl -n "$NS" scale deploy -l app.kubernetes.io/instance="$RELEASE" --replicas=2
kubectl -n "$NS" rollout status deploy -l app.kubernetes.io/instance="$RELEASE"
TARGET_HOST=https://<api-host> bash scripts/smoke-test.sh
```

Re-enable HPA scaling (`helm upgrade` with `values-prod.yaml`), update the
status page, and stop the RTO clock.

## 6. Emergency contacts and escalation

Keep this roster current; phone numbers live in the on-call tool, not in Git.

| Role | Primary | Backup | Contact |
|------|---------|--------|---------|
| On-call engineer | _name_ | _name_ | PagerDuty schedule `anchorpoint-primary` |
| Incident Commander | _name_ | _name_ | PagerDuty escalation level 2 |
| Database owner | _name_ | _name_ | |
| Security lead (keys, ransomware) | _name_ | _name_ | |
| Infrastructure / cloud admin | _name_ | _name_ | |
| Legal & compliance | _name_ | _name_ | |
| Communications (status page, partners) | _name_ | _name_ | |
| AWS Support | — | — | Enterprise support case, severity "Production system down" |

**Escalation tree**

```
Alert / report
  └─ On-call engineer (ack ≤ 5 min)
       └─ not resolved in 15 min, or data loss / key compromise suspected
            └─ Incident Commander (declares disaster, owns RTO clock)
                 ├─ Database owner        — §4.1, §4.5
                 ├─ Security lead         — §4.2, §4.3, §4.4
                 ├─ Infrastructure admin  — §4.5, §4.6
                 └─ Communications        — status page, wallets, partners
                      └─ Legal & compliance — breach / regulator notices
```

## 7. Validation checklists

**After any recovery**

- [ ] `/health` returns OK on every API replica
- [ ] `scripts/smoke-test.sh` passes against production
- [ ] SEP-10 challenge/verify works with the current `SIGNING_KEY`
- [ ] Latest `transactions` row is within the RPO window of the incident
- [ ] Database ↔ Horizon reconciliation shows no unexplained gaps
- [ ] BullMQ queues are draining; no stuck jobs
- [ ] Alerts are green in Grafana / Alertmanager
- [ ] Status page updated; incident timeline recorded for the post-mortem

**Quarterly DR drill (staging)**

Run every procedure in §4 against staging (`values-staging.yaml`) and record
the measured times. Any command that fails or exceeds its budget is fixed in
this runbook before the drill is closed.

| Date | Scenario | Operator | Time to recover | RPO observed | Result / follow-ups |
|------|----------|----------|-----------------|--------------|---------------------|
| | 4.1 PITR restore | | | | |
| | 4.3 Signing-key rotation | | | | |
| | 4.4 KMS deletion cancel | | | | |
| | 4.5 Region failover | | | | |
| | 4.6 Redis recovery | | | | |
