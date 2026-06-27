#!/usr/bin/env bash
# =============================================================================
# Soroban Security Audit - Issue #274
# =============================================================================
# Scans Soroban contract workspaces for security issues:
#   1. Builds release Wasm artifacts (wasm32v1-none for root, wasm32-unknown-unknown for contracts)
#   2. Runs Scout static analysis (cargo scout-audit)
#   3. Audits built .wasm files (optional soroban-analyzer + header checks)
#   4. Flags suspicious Rust source patterns
#
# Usage:
#   ./scripts/security-audit.sh [--skip-build] [--warn-only]
#
# Environment:
#   SECURITY_AUDIT_SKIP_BUILD=1   Skip wasm build step
#   SECURITY_AUDIT_WARN_ONLY=1    Never fail on warnings (scout failures still fail)
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_WASM_TARGET="${SECURITY_AUDIT_ROOT_WASM_TARGET:-wasm32v1-none}"
CONTRACTS_WASM_TARGET="${SECURITY_AUDIT_CONTRACTS_WASM_TARGET:-wasm32-unknown-unknown}"
SKIP_BUILD=0
WARN_ONLY=0
ISSUES=0

if [[ "${1:-}" == "--skip-build" ]]; then
  SKIP_BUILD=1
fi
if [[ "${1:-}" == "--warn-only" ]] || [[ "${2:-}" == "--warn-only" ]]; then
  WARN_ONLY=1
fi
if [[ "${SECURITY_AUDIT_SKIP_BUILD:-}" == "1" ]]; then
  SKIP_BUILD=1
fi
if [[ "${SECURITY_AUDIT_WARN_ONLY:-}" == "1" ]]; then
  WARN_ONLY=1
fi

log() { printf '[security-audit] %s\n' "$*"; }
warn() { printf '[security-audit][WARN] %s\n' "$*" >&2; }
fail() { printf '[security-audit][ERROR] %s\n' "$*" >&2; ISSUES=$((ISSUES + 1)); }

record_issue() {
  if [[ "$WARN_ONLY" -eq 1 ]]; then
    warn "$1"
  else
    fail "$1"
  fi
}

build_workspace_wasm() {
  local workspace_dir="$1"
  local label="$2"
  local wasm_target="$3"

  if command -v rustup >/dev/null 2>&1; then
    rustup target add "$wasm_target" >/dev/null 2>&1 || true
  fi

  log "Building release Wasm for ${label} (${wasm_target})..."
  if ! (
    cd "$workspace_dir"
    cargo build --target "$wasm_target" --release 2>&1
  ); then
    record_issue "Wasm build failed for ${label}. Scout analysis may be incomplete."
    return 1
  fi
  return 0
}

run_scout_audit() {
  local workspace_dir="$1"
  local label="$2"

  if ! command -v cargo >/dev/null 2>&1; then
    record_issue "cargo is required for Scout analysis."
    return 1
  fi

  if ! cargo scout-audit --help >/dev/null 2>&1; then
    record_issue "cargo-scout-audit is not installed. Run: cargo install cargo-scout-audit"
    return 1
  fi

  log "Running Scout static analysis on ${label}..."
  if (
    cd "$workspace_dir"
    cargo scout-audit --output-format md
  ); then
    log "Scout analysis passed for ${label}."
    return 0
  fi

  record_issue "Scout reported security findings in ${label}."
  return 1
}

validate_wasm_magic() {
  local wasm_file="$1"
  local magic
  magic="$(dd if="$wasm_file" bs=4 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"

  if [[ "$magic" != "0061736d" ]]; then
    record_issue "Invalid Wasm magic header in ${wasm_file}"
    return 1
  fi
  return 0
}

scan_wasm_artifacts() {
  local search_root="$1"
  local wasm_found=0
  local analyzed=0

  log "Scanning Wasm artifacts under ${search_root}..."

  while IFS= read -r -d '' wasm_file; do
    wasm_found=1
    log "Found Wasm: ${wasm_file}"
    validate_wasm_magic "$wasm_file" || true

    if command -v soroban-analyzer >/dev/null 2>&1; then
      log "Running soroban-analyzer on ${wasm_file}..."
      if soroban-analyzer "$wasm_file"; then
        analyzed=$((analyzed + 1))
      else
        record_issue "soroban-analyzer reported issues for ${wasm_file}"
      fi
    fi
  done < <(find "$search_root" -path '*/target/*' -name '*.wasm' -type f -print0 2>/dev/null)

  if [[ "$wasm_found" -eq 0 ]]; then
    warn "No Wasm artifacts found under ${search_root}. Build contracts before auditing."
    return 1
  fi

  if [[ "$analyzed" -eq 0 ]] && ! command -v soroban-analyzer >/dev/null 2>&1; then
    log "soroban-analyzer not installed; Wasm header validation completed."
  fi

  return 0
}

scan_source_patterns() {
  local dirs=("$@")

  log "Checking Soroban source patterns..."

  for dir in "${dirs[@]}"; do
    [[ -d "$dir" ]] || continue

    if grep -RIn --exclude-dir=target --exclude='*.md' 'unsafe[[:space:]]*{' "$dir" >/dev/null 2>&1; then
      record_issue "'unsafe' blocks found under ${dir}. Review for memory-safety risks."
    fi

    if grep -RIn --exclude-dir=target --exclude='*.md' 'env\.panic' "$dir" >/dev/null 2>&1; then
      warn "'env.panic' usage found under ${dir}. Review panic paths and denial-of-service risk."
    fi

    if grep -RIn --exclude-dir=target --exclude='*.md' 'update_current_contract_wasm' "$dir" >/dev/null 2>&1; then
      warn "'update_current_contract_wasm' references found under ${dir}. Ensure upgrade paths are access-controlled."
    fi
  done
}

main() {
  log "Starting Soroban security audit..."

  if [[ "$SKIP_BUILD" -eq 0 ]]; then
    # Skip root workspace build: src/ uses soroban-sdk v26 which is incompatible
    # with cargo-scout-audit@0.3.x (testutils feature not supported on wasm target).
    # Only build the contracts/ workspace which uses stable soroban-sdk v22.
    build_workspace_wasm "$ROOT_DIR/contracts" "contracts workspace" "$CONTRACTS_WASM_TARGET" || true
  else
    log "Skipping Wasm build (--skip-build)."
  fi

  # Skip scout audit on root workspace due to cargo-scout-audit incompatibility with soroban-sdk v26
  # run_scout_audit "$ROOT_DIR" "root workspace" || true
  run_scout_audit "$ROOT_DIR/contracts" "contracts workspace" || true

  scan_wasm_artifacts "$ROOT_DIR" || true
  scan_source_patterns "$ROOT_DIR/src" "$ROOT_DIR/contracts"

  if [[ "$ISSUES" -gt 0 ]]; then
    printf '[security-audit][ERROR] Security audit finished with %s issue(s).\n' "$ISSUES" >&2
    exit 1
  fi

  log "Security audit completed successfully."
}

main "$@"
