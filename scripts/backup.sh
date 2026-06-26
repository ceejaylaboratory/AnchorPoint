#!/usr/bin/env bash
# Database backup script.
# Intended to run as a cron job, e.g.:
#   0 2 * * * /path/to/AnchorPoint/scripts/backup.sh >> /var/log/anchorpoint-backup.log 2>&1
#
# Required environment variables (set in .env or the cron environment):
#   DATABASE_URL      — PostgreSQL connection string
#   BACKUP_DIR        — Directory to write backup files (default: /var/backups/anchorpoint)
#   BACKUP_RETENTION  — Number of days to keep old backups (default: 14)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/anchorpoint}"
BACKUP_RETENTION="${BACKUP_RETENTION:-14}"
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/anchorpoint-${TIMESTAMP}.sql.gz"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[$(date -u +%FT%TZ)] ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "[$(date -u +%FT%TZ)] Starting backup → ${BACKUP_FILE}"

pg_dump "${DATABASE_URL}" \
  --format=plain \
  --no-owner \
  --no-acl \
  | gzip > "${BACKUP_FILE}"

echo "[$(date -u +%FT%TZ)] Backup complete ($(du -sh "${BACKUP_FILE}" | cut -f1))"

# Remove backups older than BACKUP_RETENTION days
find "${BACKUP_DIR}" -name "anchorpoint-*.sql.gz" -mtime "+${BACKUP_RETENTION}" -print -delete \
  | sed "s/^/[$(date -u +%FT%TZ)] Removed old backup: /"

echo "[$(date -u +%FT%TZ)] Done"
