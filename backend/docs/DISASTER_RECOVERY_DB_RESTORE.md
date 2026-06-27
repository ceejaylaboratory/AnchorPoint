# Database Restore Disaster Recovery Runbook

This runbook verifies that AnchorPoint can restore its SQLite-backed backend database before testnet deployment. It is intentionally focused on database availability, integrity, and operational safety; it does not print secrets or row-level customer data.

## Scope

- Backend database configured by `DATABASE_URL`.
- Docker Compose deployment using the `backend-data` volume.
- Local development database at `backend/prisma/dev.db`.
- Restore validation for Prisma-managed tables, KYC records, API keys, transactions, recurring payments, notifications, and system configuration.

Redis, Jaeger, and Prometheus data are out of scope for this procedure. They should be recreated or restored through their own service-specific backup plans.

## Recovery Objectives

| Objective | Target |
| --- | --- |
| RPO | Latest verified database backup |
| RTO | Under 30 minutes for local/testnet SQLite restore |
| Integrity gate | `PRAGMA quick_check` returns `ok` |
| Data gate | Restored table list and row counts match the backup source |
| App gate | Backend health endpoint responds after restart |

## Prerequisites

- Access to the deployment host or local checkout.
- `sqlite3` CLI installed on the host running the verification.
- Node.js and npm installed for the backend verification helper.
- A recent backup file stored outside the application data volume.
- No private keys, JWT secrets, KYC documents, or API key values pasted into logs or issue comments.

## Local Verification Command

Run from `backend/`:

```bash
npm run db:restore:verify
```

The command reads `DATABASE_URL` when set. If `DATABASE_URL` is absent, it verifies `file:./prisma/dev.db`.

To verify a specific SQLite file:

```bash
npm run db:restore:verify -- --source ./prisma/dev.db
```

To place evidence files in a known directory:

```bash
npm run db:restore:verify -- --source ./prisma/dev.db --backup-dir ./tmp/dr-restore
```

The helper performs these checks:

- Confirms the source database exists.
- Runs `PRAGMA quick_check` on the source database.
- Creates a SQLite backup using the SQLite online backup command.
- Restores the backup into an isolated probe database.
- Runs `PRAGMA quick_check` on the backup and restored probe.
- Compares user table names and row counts between the source and restored probe.

## Docker Testnet Backup Procedure

Create a host-side backup directory:

```bash
mkdir -p backups
```

Create a backup from the `backend-data` Docker volume:

```bash
docker run --rm \
  -v anchorpoint_backend-data:/data \
  -v "$PWD/backups:/backups" \
  alpine:3.20 \
  sh -lc 'apk add --no-cache sqlite >/dev/null && sqlite3 /data/dev.db ".backup /backups/anchorpoint-$(date -u +%Y%m%dT%H%M%SZ).db"'
```

Verify the newest backup:

```bash
sqlite3 backups/<backup-file>.db "PRAGMA quick_check;"
```

Expected output:

```text
ok
```

## Docker Testnet Restore Procedure

Pause writes before restoring. For the Compose deployment, stop the backend while leaving Redis and observability services available:

```bash
docker compose stop backend
```

Preserve the current database before replacing it:

```bash
docker run --rm \
  -v anchorpoint_backend-data:/data \
  -v "$PWD/backups:/backups" \
  alpine:3.20 \
  sh -lc 'apk add --no-cache sqlite >/dev/null && cp /data/dev.db /backups/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).db'
```

Restore the selected backup:

```bash
docker run --rm \
  -v anchorpoint_backend-data:/data \
  -v "$PWD/backups:/backups" \
  alpine:3.20 \
  sh -lc 'cp /backups/<backup-file>.db /data/dev.db && chmod 600 /data/dev.db'
```

Start the backend:

```bash
docker compose up -d backend
```

Validate service health:

```bash
curl -fsS http://localhost:3002/health
```

Run migration and restore checks from the backend workspace when dependencies are available:

```bash
npm run migrate:status
npm run db:restore:verify -- --source ./prisma/dev.db --backup-dir ./tmp/dr-restore
```

## Post-Restore QA Checklist

- `sqlite3 <restored-db> "PRAGMA quick_check;"` returns `ok`.
- Table names match the source backup.
- Row counts match the source backup for all application tables.
- Backend `/health` returns success after restart.
- Logs do not include private keys, JWT secrets, API key values, KYC documents, or full customer payloads.
- Recent transaction, KYC, API key, recurring payment, and notification records are visible through normal application paths.
- Any failed restore attempt has been rolled back using the preserved `pre-restore-*` copy.

## Failure and Rollback

If the backend does not start or validation fails:

1. Stop the backend.
2. Replace `/data/dev.db` with the `pre-restore-*` copy.
3. Restart the backend.
4. Confirm `/health` responds.
5. Capture the failing command, exit code, and sanitized logs.

Do not continue with testnet deployment until the restore probe passes or the failed restore is explicitly accepted by maintainers.

## PR Evidence Template

Use this format in pull requests or release notes:

```text
DB restore verification
- Source: <environment or database file>
- Backup path: <sanitized path>
- Restore probe path: <sanitized path>
- PRAGMA quick_check: ok
- Tables verified: <count>
- Rows verified: <count>
- Health check: <pass/fail>
- Notes: <manual observations or rollback notes>
```
