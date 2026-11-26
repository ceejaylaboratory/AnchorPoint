#!/usr/bin/env bash
#
# encrypt-backup.sh
#
# Client-side GPG encryption for database backup dumps.
#
# Produces PostgreSQL dumps that are compressed and encrypted with an
# asymmetric GPG recipient key BEFORE they are written to disk or uploaded
# to cloud storage (S3 / GCS). The plaintext dump never touches the
# filesystem, so a compromised cloud account or host disk only ever sees
# ciphertext.
#
# Intended to run as a cron job, e.g.:
#   0 2 * * * /path/to/AnchorPoint/backend/scripts/encrypt-backup.sh \
#     >> /var/log/anchorpoint-encrypted-backup.log 2>&1
#
# ---------------------------------------------------------------------------
# Required environment variables
# ---------------------------------------------------------------------------
#   DATABASE_URL      — PostgreSQL connection string
#
# Optional environment variables
# ---------------------------------------------------------------------------
#   BACKUP_DIR           — Directory for encrypted backups
#                          (default: /var/backups/anchorpoint)
#   BACKUP_RETENTION     — Days to keep old encrypted backups (default: 14)
#   GPG_RECIPIENT        — GPG recipient for encryption
#                          (default: admin@anchorpoint.io)
#   GPG_KEYRING          — GPG home directory containing the PUBLIC key only
#                          (default: $GNUPGHOME or $HOME/.gnupg)
#   GPG_PUBLIC_KEY_FILE  — Armored public key (.asc/.gpg) imported into
#                          GPG_KEYRING on first run if the recipient is absent
#   BACKUP_UPLOAD_URI    — Optional upload destination prefix:
#                          s3://bucket/path/  or  gs://bucket/path/
#   AWS_DEFAULT_REGION   — AWS region for s3:// uploads (default: us-east-1)
#   ALERT_WEBHOOK_URL    — Slack/PagerDuty incoming webhook for failures
#   GPG_ALLOW_SECRET=1   — Development escape hatch: permit a secret key for
#                          the recipient to exist in GPG_KEYRING. NEVER set
#                          this on production — the private key must live in
#                          cold storage, not on the server.
#
# Exit codes:
#   0  backup encrypted (and uploaded, if configured)
#   1  backup / encryption / upload failed
#   2  configuration or prerequisite error
#
# Private key handling:
#   The script REFUSES to run if the recipient's secret key is present in
#   GPG_KEYRING. Decryption is performed offline with the private key held
#   in cold storage, e.g.:
#     gpg --homedir /secure/offline-keyring --decrypt anchorpoint-<ts>.sql.gz.gpg \
#       | gunzip | psql "$DATABASE_URL"

set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/anchorpoint}"
BACKUP_RETENTION="${BACKUP_RETENTION:-14}"
GPG_RECIPIENT="${GPG_RECIPIENT:-admin@anchorpoint.io}"
GPG_KEYRING="${GPG_KEYRING:-${GNUPGHOME:-$HOME/.gnupg}}"
GPG_PUBLIC_KEY_FILE="${GPG_PUBLIC_KEY_FILE:-}"
BACKUP_UPLOAD_URI="${BACKUP_UPLOAD_URI:-}"
AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
GPG_ALLOW_SECRET="${GPG_ALLOW_SECRET:-0}"

TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/anchorpoint-${TIMESTAMP}.sql.gz.gpg"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

export AWS_DEFAULT_REGION

LOG_PREFIX="[encrypt-backup]"
log()    { echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') ${LOG_PREFIX} INFO  $*"; }
warn()   { echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') ${LOG_PREFIX} WARN  $*" >&2; }
err()    { echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') ${LOG_PREFIX} ERROR $*" >&2; }

# --- Failure alert (non-fatal) ---------------------------------------------
send_alert() {
  local summary="$1" detail="$2" payload
  [[ -z "${ALERT_WEBHOOK_URL}" ]] && return 0
  payload="$(jq -n --arg s "${summary}" --arg d "${detail}" \
    '{event:"anchorpoint-encrypted-backup",severity:"error",summary:$s,detail:$d,timestamp:(now|todate)}' 2>/dev/null)" || return 0
  curl -fsS -m 15 -H "Content-Type: application/json" -d "${payload}" \
    "${ALERT_WEBHOOK_URL}" >/dev/null 2>&1 || warn "Alert webhook delivery failed (non-fatal)"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "Required command not found: $1"; exit 2; }
}

gpg_run() {
  gpg --homedir "${GPG_KEYRING}" --batch --yes "$@"
}

# Import the recipient public key if it is not already in the keyring.
ensure_public_key() {
  if gpg_run --list-keys "${GPG_RECIPIENT}" >/dev/null 2>&1; then
    return 0
  fi

  if [[ -n "${GPG_PUBLIC_KEY_FILE}" && -f "${GPG_PUBLIC_KEY_FILE}" ]]; then
    log "Importing public key from ${GPG_PUBLIC_KEY_FILE}"
    gpg_run --import "${GPG_PUBLIC_KEY_FILE}"
    gpg_run --list-keys "${GPG_RECIPIENT}" >/dev/null 2>&1 && return 0
  fi

  err "No public key for recipient '${GPG_RECIPIENT}' in ${GPG_KEYRING}."
  err "Set GPG_PUBLIC_KEY_FILE to an armored public key, or pre-import it:"
  err "  gpg --homedir ${GPG_KEYRING} --import backup-public-key.asc"
  return 1
}

# Hard guard: the private decryption key must never live on this host.
# Production keyrings contain ONLY the public recipient key.
check_no_secret_key() {
  if [[ "${GPG_ALLOW_SECRET}" == "1" ]]; then
    warn "GPG_ALLOW_SECRET=1 — secret key check bypassed (dev only)"
    return 0
  fi

  local secret_count
  secret_count="$(gpg_run --with-colons --list-secret-keys "${GPG_RECIPIENT}" 2>/dev/null \
    | grep -c '^sec' || true)"
  if [[ "${secret_count}" -gt 0 ]]; then
    err "Secret key for '${GPG_RECIPIENT}' found in ${GPG_KEYRING}."
    err "The private key must be held offline in cold storage, not on the"
    err "backup host. Remove it and re-run. (Dev override: GPG_ALLOW_SECRET=1)"
    return 1
  fi
}

upload() {
  local file="$1"
  [[ -z "${BACKUP_UPLOAD_URI}" ]] && { log "BACKUP_UPLOAD_URI unset — keeping ${file} locally"; return 0; }

  case "${BACKUP_UPLOAD_URI}" in
    s3://*)
      require_cmd aws
      aws s3 cp "${file}" "${BACKUP_UPLOAD_URI%/}/$(basename "${file}")" --only-show-errors
      ;;
    gs://*)
      require_cmd gsutil
      gsutil cp "${file}" "${BACKUP_UPLOAD_URI%/}/$(basename "${file}")"
      ;;
    *)
      err "Unsupported BACKUP_UPLOAD_URI scheme: ${BACKUP_UPLOAD_URI}"
      return 1
      ;;
  esac
  log "Uploaded $(basename "${file}") → ${BACKUP_UPLOAD_URI%/}/"
}

main() {
  require_cmd pg_dump
  require_cmd gpg
  require_cmd gzip
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 \
    || { err "Neither sha256sum nor shasum found"; exit 2; }

  if [[ -z "${DATABASE_URL:-}" ]]; then
    err "DATABASE_URL is not set"
    send_alert "AnchorPoint encrypted backup failed" "DATABASE_URL is not set"
    exit 1
  fi

  ensure_public_key || { send_alert "AnchorPoint encrypted backup failed" "GPG public key for ${GPG_RECIPIENT} unavailable"; exit 1; }
  check_no_secret_key || { send_alert "AnchorPoint encrypted backup failed" "Secret key present in keyring — aborting"; exit 1; }

  mkdir -p "${BACKUP_DIR}"
  chmod 700 "${GPG_KEYRING}" 2>/dev/null || true

  log "Starting encrypted backup → ${BACKUP_FILE} (recipient: ${GPG_RECIPIENT})"

  # pg_dump | gzip | gpg — plaintext never touches disk.
  if ! pg_dump "${DATABASE_URL}" \
      --format=plain --no-owner --no-acl \
    | gzip -c \
    | gpg_run --trust-model always \
        --encrypt --recipient "${GPG_RECIPIENT}" \
        --output "${BACKUP_FILE}"; then
    err "pg_dump | gpg encryption pipeline failed"
    rm -f "${BACKUP_FILE}" "${CHECKSUM_FILE}"
    send_alert "AnchorPoint encrypted backup failed" "Encryption pipeline failed for ${BACKUP_FILE}"
    exit 1
  fi

  log "Encrypted backup complete ($(du -sh "${BACKUP_FILE}" | cut -f1))"

  # Integrity checksum sidecar
  local sum_cmd
  if command -v sha256sum >/dev/null 2>&1; then
    sum_cmd="sha256sum"
  else
    sum_cmd="shasum -a 256"
  fi
  (cd "${BACKUP_DIR}" && ${sum_cmd} "$(basename "${BACKUP_FILE}")" \
    > "$(basename "${CHECKSUM_FILE}")")
  log "Checksum written → ${CHECKSUM_FILE}"

  upload "${BACKUP_FILE}" || { send_alert "AnchorPoint encrypted backup failed" "Upload failed for ${BACKUP_FILE}"; exit 1; }
  upload "${CHECKSUM_FILE}" || warn "Checksum upload failed (non-fatal)"

  # Retention: only encrypted artifacts are ever stored
  find "${BACKUP_DIR}" -name 'anchorpoint-*.sql.gz.gpg*' -mtime "+${BACKUP_RETENTION}" \
    -print -delete | sed "s/^/[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ${LOG_PREFIX} Removed old backup: /"

  log "Done"
}

main "$@"
