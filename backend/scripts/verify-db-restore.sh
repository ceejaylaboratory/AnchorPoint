#!/usr/bin/env bash
#
# verify-db-restore.sh
#
# Automated nightly PostgreSQL WAL restore verification.
#
# This script:
#   1. Downloads a base backup and WAL archive segments from S3/GCS.
#   2. Spins up a temporary Docker Postgres container (postgres:16-alpine).
#   3. Restores the base backup, configures recovery (standby.signal +
#      restore_command + recovery_target_time) and replays WAL.
#   4. Waits for recovery to complete and the DB to accept connections.
#   5. Runs integrity validation queries (row counts, FK consistency,
#      table checksums) against Transaction, Customer, and ApiKey tables.
#   6. Emits a success/failure webhook notification to Slack/Alertmanager.
#   7. Always cleans up the temp container and files via a trap.
#
# ---------------------------------------------------------------------------
# Scheduling
# ---------------------------------------------------------------------------
# This script is intended to run nightly. Two supported options:
#
# Option A: Kubernetes CronJob (recommended for production)
#
#   apiVersion: batch/v1
#   kind: CronJob
#   metadata:
#     name: verify-db-restore
#     namespace: infra
#   spec:
#     schedule: "0 3 * * *"          # nightly at 03:00 UTC
#     concurrencyPolicy: Forbid
#     successfulJobsHistoryLimit: 3
#     failedJobsHistoryLimit: 3
#     jobTemplate:
#       spec:
#         backoffLimit: 1
#         activeDeadlineSeconds: 3600
#         template:
#           spec:
#             restartPolicy: Never
#             containers:
#               - name: verify-db-restore
#                 image: ghcr.io/your-org/db-verify-tools:latest
#                 command: ["/bin/bash", "/scripts/verify-db-restore.sh"]
#                 envFrom:
#                   - secretRef:
#                       name: db-restore-verify-secrets
#                 env:
#                   - name: BACKUP_S3_URI
#                     value: "s3://my-bucket/postgres/base/latest"
#                   - name: WAL_S3_URI
#                     value: "s3://my-bucket/postgres/wal"
#                   - name: RECOVERY_TARGET_TIME
#                     value: "latest"
#                 volumeMounts:
#                   - name: docker-sock
#                     mountPath: /var/run/docker.sock
#                   - name: scripts
#                     mountPath: /scripts
#             volumes:
#               - name: docker-sock
#                 hostPath:
#                   path: /var/run/docker.sock
#               - name: scripts
#                 configMap:
#                   name: verify-db-restore-script
#
# Option B: CI nightly job (e.g. GitHub Actions)
#
#   on:
#     schedule:
#       - cron: "0 3 * * *"
#   jobs:
#     verify-db-restore:
#       runs-on: ubuntu-latest
#       steps:
#         - uses: actions/checkout@v4
#         - name: Run restore verification
#           env:
#             BACKUP_S3_URI: ${{ secrets.BACKUP_S3_URI }}
#             WAL_S3_URI: ${{ secrets.WAL_S3_URI }}
#             AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
#             AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
#             ALERT_WEBHOOK_URL: ${{ secrets.ALERT_WEBHOOK_URL }}
#           run: bash backend/scripts/verify-db-restore.sh
#
# ---------------------------------------------------------------------------
# Required environment variables
# ---------------------------------------------------------------------------
#   BACKUP_S3_URI          s3://bucket/path/to/base-backup.tar.gz  (or gs://...)
#   WAL_S3_URI             s3://bucket/path/to/wal/                (or gs://...)
#   ALERT_WEBHOOK_URL      Slack/Alertmanager incoming webhook URL
#
# Optional environment variables
# ---------------------------------------------------------------------------
#   RECOVERY_TARGET_TIME   ISO-8601 timestamp (e.g. 2024-01-15T03:00:00Z)
#                          or "latest" (default: latest)
#   AWS_ACCESS_KEY_ID      AWS credentials (if not using instance role)
#   AWS_SECRET_ACCESS_KEY  AWS credentials
#   AWS_DEFAULT_REGION     AWS region (default: us-east-1)
#   GCS_ACCESS_TOKEN       GCS access token (if using gs:// URIs)
#   PG_CONTAINER_NAME      Docker container name (default: verify-db-restore-<pid>)
#   PG_IMAGE               Postgres image (default: postgres:16-alpine)
#   PG_PORT                Host port to expose (default: 55432)
#   PG_SUPERUSER           Postgres superuser (default: postgres)
#   PG_PASSWORD            Postgres password (default: postgres)
#   EXPECTED_ROW_COUNTS    JSON map of table -> expected row count
#                          e.g. '{"Transaction":1000,"Customer":50,"ApiKey":10}'
#   EXPECTED_CHECKSUMS     JSON map of table -> expected md5 checksum
#                          e.g. '{"Transaction":"abc...","Customer":"def..."}'
#   KEEP_TEMP              If "1", do not delete temp dir on exit (debug)
#
# Exit codes:
#   0  verification succeeded
#   1  verification failed (restore or integrity check)
#   2  configuration / prerequisite error
#
# ---------------------------------------------------------------------------

set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Logging (mirrors scripts/backup.sh conventions)
# ---------------------------------------------------------------------------
LOG_PREFIX="[verify-db-restore]"
log()  { echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') ${LOG_PREFIX} INFO  $*"; }
warn() { echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') ${LOG_PREFIX} WARN  $*" >&2; }
err()  { echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') ${LOG_PREFIX} ERROR $*" >&2; }

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
RECOVERY_TARGET_TIME="${RECOVERY_TARGET_TIME:-latest}"
AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
PG_PORT="${PG_PORT:-55432}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
PG_PASSWORD="${PG_PASSWORD:-postgres}"
PG_CONTAINER_NAME="${PG_CONTAINER_NAME:-verify-db-restore-$$}"
KEEP_TEMP="${KEEP_TEMP:-0}"
EXPECTED_ROW_COUNTS="${EXPECTED_ROW_COUNTS:-}"
EXPECTED_CHECKSUMS="${EXPECTED_CHECKSUMS:-}"

export AWS_DEFAULT_REGION

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
TMP_DIR=""
CONTAINER_STARTED=0
START_TS="$(date -u +%s)"
STATUS="failure"
FAILURE_REASON=""
RESTORE_LOG=""

# ---------------------------------------------------------------------------
# Webhook notification
# ---------------------------------------------------------------------------
notify() {
  local status="$1"
  local message="$2"
  local duration=$(( $(date -u +%s) - START_TS ))

  if [[ -z "${ALERT_WEBHOOK_URL:-}" ]]; then
    warn "ALERT_WEBHOOK_URL not set; skipping webhook notification"
    return 0
  fi

  local emoji color
  if [[ "$status" == "success" ]]; then
    emoji=":white_check_mark:"
    color="good"
  else
    emoji=":rotating_light:"
    color="danger"
  fi

  local payload
  payload=$(cat <<EOF
{
  "text": "${emoji} PostgreSQL restore verification ${status}",
  "attachments": [
    {
      "color": "${color}",
      "fields": [
        { "title": "Status", "value": "${status}", "short": true },
        { "title": "Duration", "value": "${duration}s", "short": true },
        { "title": "Recovery Target", "value": "${RECOVERY_TARGET_TIME}", "short": true },
        { "title": "Backup URI", "value": "${BACKUP_S3_URI:-<unset>}", "short": false },
        { "title": "Message", "value": "${message}", "short": false }
      ]
    }
  ]
}
EOF
)

  if ! curl -fsS -X POST -H 'Content-Type: application/json' \
      --data "$payload" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1; then
    warn "Failed to deliver webhook notification to ALERT_WEBHOOK_URL"
  else
    log "Webhook notification delivered (status=${status})"
  fi
}

# ---------------------------------------------------------------------------
# Cleanup trap
# ---------------------------------------------------------------------------
cleanup() {
  local exit_code=$?
  set +e

  if [[ "$CONTAINER_STARTED" -eq 1 ]]; then
    log "Stopping and removing container ${PG_CONTAINER_NAME}"
    docker rm -f "$PG_CONTAINER_NAME" >/dev/null 2>&1 || true
  fi

  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    if [[ "$KEEP_TEMP" == "1" ]]; then
      warn "KEEP_TEMP=1; leaving temp dir ${TMP_DIR} in place"
    else
      log "Removing temp dir ${TMP_DIR}"
      rm -rf "$TMP_DIR" || true
    fi
  fi

  if [[ "$exit_code" -ne 0 && "$STATUS" != "failure" ]]; then
    STATUS="failure"
    FAILURE_REASON="${FAILURE_REASON:-unexpected exit code ${exit_code}}"
  fi

  if [[ "$STATUS" == "success" ]]; then
    notify "success" "Restore verification completed successfully"
  else
    notify "failure" "${FAILURE_REASON:-restore verification failed}"
  fi

  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Required command not found: $1"
    exit 2
  fi
}

check_prereqs() {
  require_cmd docker
  require_cmd curl
  require_cmd tar

  if [[ -z "${BACKUP_S3_URI:-}" ]]; then
    err "BACKUP_S3_URI is required"
    exit 2
  fi
  if [[ -z "${WAL_S3_URI:-}" ]]; then
    err "WAL_S3_URI is required"
    exit 2
  fi

  case "$BACKUP_S3_URI" in
    s3://*) require_cmd aws ;;
    gs://*) require_cmd gsutil ;;
    *)      err "Unsupported BACKUP_S3_URI scheme: $BACKUP_S3_URI"; exit 2 ;;
  esac

  case "$WAL_S3_URI" in
    s3://*) require_cmd aws ;;
    gs://*) require_cmd gsutil ;;
    *)      err "Unsupported WAL_S3_URI scheme: $WAL_S3_URI"; exit 2 ;;
  esac

  if ! docker info >/dev/null 2>&1; then
    err "Docker daemon is not reachable"
    exit 2
  fi
}

# ---------------------------------------------------------------------------
# Download helpers
# ---------------------------------------------------------------------------
download_base_backup() {
  local dest="$1"
  log "Downloading base backup from ${BACKUP_S3_URI}"

  case "$BACKUP_S3_URI" in
    s3://*)
      aws s3 cp "$BACKUP_S3_URI" "$dest" --only-show-errors
      ;;
    gs://*)
      gsutil cp "$BACKUP_S3_URI" "$dest"
      ;;
  esac

  if [[ ! -s "$dest" ]]; then
    err "Base backup download produced empty file: $dest"
    return 1
  fi
  log "Base backup downloaded ($(du -h "$dest" | cut -f1))"
}

download_wal_archive() {
  local dest="$1"
  log "Downloading WAL archive from ${WAL_S3_URI}"
  mkdir -p "$dest"

  case "$WAL_S3_URI" in
    s3://*)
      aws s3 sync "$WAL_S3_URI" "$dest" --only-show-errors
      ;;
    gs://*)
      gsutil -m rsync -r "$WAL_S3_URI" "$dest"
      ;;
  esac

  local count
  count=$(find "$dest" -type f | wc -l | tr -d ' ')
  if [[ "$count" -eq 0 ]]; then
    err "No WAL segments found in ${WAL_S3_URI}"
    return 1
  fi
  log "Downloaded ${count} WAL segment(s)"
}

# ---------------------------------------------------------------------------
# Restore preparation
# ---------------------------------------------------------------------------
prepare_pgdata() {
  local backup_file="$1"
  local pgdata="$2"

  log "Extracting base backup into ${pgdata}"
  mkdir -p "$pgdata"

  # Support both tar.gz and plain tar archives.
  case "$backup_file" in
    *.tar.gz|*.tgz)
      tar -xzf "$backup_file" -C "$pgdata" --strip-components=1
      ;;
    *.tar)
      tar -xf "$backup_file" -C "$pgdata" --strip-components=1
      ;;
    *)
      err "Unsupported base backup format: $backup_file"
      return 1
      ;;
  esac

  # Ensure the postgres user inside the container owns the data dir.
  chmod -R u+rwX "$pgdata" || true
}

write_recovery_config() {
  local pgdata="$1"
  local wal_dir="$2"

  log "Writing recovery configuration (target=${RECOVERY_TARGET_TIME})"

  # Postgres 12+ uses standby.signal instead of recovery.conf.
  touch "$pgdata/standby.signal"

  # restore_command copies WAL segments from the downloaded archive.
  # The container mounts the WAL dir at /wal.
  cat >> "$pgdata/postgresql.auto.conf" <<EOF
restore_command = 'cp /wal/%f %p'
recovery_target_action = 'promote'
EOF

  if [[ "$RECOVERY_TARGET_TIME" != "latest" ]]; then
    cat >> "$pgdata/postgresql.auto.conf" <<EOF
recovery_target_time = '${RECOVERY_TARGET_TIME}'
recovery_target_inclusive = on
EOF
  fi

  # Allow connections from the host.
  cat >> "$pgdata/postgresql.auto.conf" <<EOF
listen_addresses = '*'
EOF

  # Ensure host auth is permissive for the verification container.
  if [[ -f "$pgdata/pg_hba.conf" ]]; then
    cat >> "$pgdata/pg_hba.conf" <<EOF
host all all 0.0.0.0/0 md5
host all all ::/0 md5
EOF
  fi

  # Fix ownership so the postgres user inside the container can read/write.
  chmod -R u+rwX "$pgdata" || true
}

# ---------------------------------------------------------------------------
# Container lifecycle
# ---------------------------------------------------------------------------
start_container() {
  local pgdata="$1"
  local wal_dir="$2"

  log "Starting temporary Postgres container ${PG_CONTAINER_NAME} (${PG_IMAGE})"

  docker run -d \
    --name "$PG_CONTAINER_NAME" \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" \
    -e POSTGRES_USER="$PG_SUPERUSER" \
    -e PGDATA=/var/lib/postgresql/data \
    -p "127.0.0.1:${PG_PORT}:5432" \
    -v "${pgdata}:/var/lib/postgresql/data" \
    -v "${wal_dir}:/wal:ro" \
    "$PG_IMAGE" >/dev/null

  CONTAINER_STARTED=1
  log "Container started"
}

wait_for_recovery() {
  local max_wait="${1:-300}"
  local elapsed=0

  log "Waiting for recovery to complete and DB to accept connections (max ${max_wait}s)"

  while [[ "$elapsed" -lt "$max_wait" ]]; do
    # Check container is still running.
    if ! docker inspect -f '{{.State.Running}}' "$PG_CONTAINER_NAME" 2>/dev/null | grep -q true; then
      err "Container exited unexpectedly"
      docker logs "$PG_CONTAINER_NAME" 2>&1 | tail -n 100 >&2 || true
      return 1
    fi

    # Check if recovery has finished (pg_is_in_recovery returns f).
    local in_recovery
    in_recovery=$(docker exec "$PG_CONTAINER_NAME" \
      psql -U "$PG_SUPERUSER" -d postgres -tAc "SELECT pg_is_in_recovery();" 2>/dev/null || echo "error")

    if [[ "$in_recovery" == "f" ]]; then
      log "Recovery complete; database is accepting connections"
      return 0
    fi

    sleep 5
    elapsed=$(( elapsed + 5 ))
  done

  err "Timed out waiting for recovery to complete after ${max_wait}s"
  docker logs "$PG_CONTAINER_NAME" 2>&1 | tail -n 100 >&2 || true
  return 1
}

# ---------------------------------------------------------------------------
# Integrity validation
# ---------------------------------------------------------------------------
psql_exec() {
  docker exec -i "$PG_CONTAINER_NAME" \
    psql -U "$PG_SUPERUSER" -d postgres -v ON_ERROR_STOP=1 -tAc "$1"
}

json_get() {
  # Extract a value from a flat JSON object by key.
  local json="$1"
  local key="$2"
  echo "$json" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p"
}

validate_integrity() {
  local failures=0

  log "Running integrity validation queries"

  # --- Row counts -----------------------------------------------------------
  local tables=("Transaction" "Customer" "ApiKey")
  local table
  for table in "${tables[@]}"; do
    local count
    count=$(psql_exec "SELECT COUNT(*) FROM \"${table}\";" 2>/dev/null || echo "error")
    if [[ "$count" == "error" || -z "$count" ]]; then
      err "Failed to query row count for table ${table}"
      failures=$(( failures + 1 ))
      continue
    fi
    log "Row count for ${table}: ${count}"

    if [[ -n "$EXPECTED_ROW_COUNTS" ]]; then
      local expected
      expected=$(json_get "$EXPECTED_ROW_COUNTS" "$table")
      if [[ -n "$expected" && "$expected" != "$count" ]]; then
        err "Row count mismatch for ${table}: expected ${expected}, got ${count}"
        failures=$(( failures + 1 ))
      fi
    fi
  done

  # --- Foreign key consistency ---------------------------------------------
  # Orphaned Transaction.userId
  local orphan_tx
  orphan_tx=$(psql_exec "SELECT COUNT(*) FROM \"Transaction\" t LEFT JOIN \"Customer\" c ON t.\"userId\" = c.id WHERE c.id IS NULL;" 2>/dev/null || echo "error")
  if [[ "$orphan_tx" == "error" ]]; then
    err "Failed to check orphaned Transaction.userId"
    failures=$(( failures + 1 ))
  elif [[ "$orphan_tx" != "0" ]]; then
    err "Found ${orphan_tx} orphaned Transaction rows (userId not in Customer)"
    failures=$(( failures + 1 ))
  else
    log "FK check Transaction.userId -> Customer.id: OK"
  fi

  # Orphaned ApiKey.userId
  local orphan_key
  orphan_key=$(psql_exec "SELECT COUNT(*) FROM \"ApiKey\" k LEFT JOIN \"Customer\" c ON k.\"userId\" = c.id WHERE c.id IS NULL;" 2>/dev/null || echo "error")
  if [[ "$orphan_key" == "error" ]]; then
    err "Failed to check orphaned ApiKey.userId"
    failures=$(( failures + 1 ))
  elif [[ "$orphan_key" != "0" ]]; then
    err "Found ${orphan_key} orphaned ApiKey rows (userId not in Customer)"
    failures=$(( failures + 1 ))
  else
    log "FK check ApiKey.userId -> Customer.id: OK"
  fi

  # --- Table checksums ------------------------------------------------------
  # md5 of ordered rows (deterministic ordering by primary key).
  local checksum_tables=("Transaction" "Customer" "ApiKey")
  for table in "${checksum_tables[@]}"; do
    local checksum
    checksum=$(psql_exec "SELECT md5(string_agg(t::text, '' ORDER BY t.id)) FROM \"${table}\" t;" 2>/dev/null || echo "error")
    if [[ "$checksum" == "error" || -z "$checksum" ]]; then
      err "Failed to compute checksum for table ${table}"
      failures=$(( failures + 1 ))
      continue
    fi
    log "Checksum for ${table}: ${checksum}"

    if [[ -n "$EXPECTED_CHECKSUMS" ]]; then
      local expected
      expected=$(json_get "$EXPECTED_CHECKSUMS" "$table")
      if [[ -n "$expected" && "$expected" != "$checksum" ]]; then
        err "Checksum mismatch for ${table}: expected ${expected}, got ${checksum}"
        failures=$(( failures + 1 ))
      fi
    fi
  done

  if [[ "$failures" -gt 0 ]]; then
    FAILURE_REASON="integrity validation failed (${failures} check(s))"
    return 1
  fi

  log "All integrity checks passed"
  return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  log "Starting PostgreSQL restore verification"
  log "Backup URI: ${BACKUP_S3_URI:-<unset>}"
  log "WAL URI:    ${WAL_S3_URI:-<unset>}"
  log "Target:     ${RECOVERY_TARGET_TIME}"

  check_prereqs

  TMP_DIR=$(mktemp -d -t verify-db-restore-XXXXXX)
  log "Using temp dir ${TMP_DIR}"

  local backup_file="${TMP_DIR}/base-backup.tar.gz"
  local wal_dir="${TMP_DIR}/wal"
  local pgdata="${TMP_DIR}/pgdata"

  download_base_backup "$backup_file" || { FAILURE_REASON="base backup download failed"; exit 1; }
  download_wal_archive "$wal_dir" || { FAILURE_REASON="WAL archive download failed"; exit 1; }

  prepare_pgdata "$backup_file" "$pgdata" || { FAILURE_REASON="base backup extraction failed"; exit 1; }
  write_recovery_config "$pgdata" "$wal_dir"

  # The container runs as the postgres user (uid 999 by default in the
  # official image). Ensure the mounted dirs are accessible.
  chmod -R a+rwX "$pgdata" || true
  chmod -R a+rX "$wal_dir" || true

  start_container "$pgdata" "$wal_dir"

  if ! wait_for_recovery 300; then
    FAILURE_REASON="recovery did not complete"
    exit 1
  fi

  if ! validate_integrity; then
    exit 1
  fi

  STATUS="success"
  log "Restore verification succeeded"
}

main "$@"