#!/usr/bin/env bash
# bootstrap-db.sh
#
# One-shot local development database setup.
# Idempotent: safe to run repeatedly.
#
# Usage:
#   ./scripts/bootstrap-db.sh               # uses .env file
#   DATABASE_URL=file:./dev.db ./scripts/bootstrap-db.sh
#
# What this does:
#   1. Validates the migration environment (DATABASE_URL etc.)
#   2. Generates the Prisma client
#   3. Applies all pending migrations deterministically (migrate deploy)
#   4. Runs a quick schema-drift check
#   5. Prints migration status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${BACKEND_DIR}"

# ── Load .env if present ──────────────────────────────────────────────────────
if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  echo "ℹ️  Loaded .env"
fi

DATABASE_URL="${DATABASE_URL:-file:./prisma/dev.db}"
export DATABASE_URL

echo ""
echo "🔧  AnchorPoint — Local Database Bootstrap"
echo "    DATABASE_URL: ${DATABASE_URL}"
echo ""

# ── Step 1: validate environment ──────────────────────────────────────────────
echo "Step 1/4 — Validating environment"
node scripts/validate-migration-env.js

# ── Step 2: generate Prisma client ───────────────────────────────────────────
echo ""
echo "Step 2/4 — Generating Prisma client"
npx prisma generate

# ── Step 3: apply migrations ──────────────────────────────────────────────────
echo ""
echo "Step 3/4 — Applying migrations"
npx prisma migrate deploy

# ── Step 4: drift + status check ─────────────────────────────────────────────
echo ""
echo "Step 4/4 — Checking schema drift and migration status"
npx prisma migrate status

echo ""
echo "✅  Database bootstrap complete.  You can start the server with: npm run dev"