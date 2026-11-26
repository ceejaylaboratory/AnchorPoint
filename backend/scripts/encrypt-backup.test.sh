#!/usr/bin/env bash
#
# encrypt-backup.test.sh
#
# Integration test for encrypt-backup.sh:
#   1. Generates an ephemeral GPG keypair in a temp keyring.
#   2. Builds a PUBLIC-ONLY keyring (simulating the production host).
#   3. Runs encrypt-backup.sh with mocked pg_dump and decrypts the result
#      with the private key in the separate keyring.
#   4. Verifies the script REFUSES to run when the secret key is present.
#
# Requires: bash, gpg (>= 2.2), gzip. No database, network, or cloud access.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/encrypt-backup.sh"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

failures=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; failures=$((failures + 1)); }

# --- Prereqs ---------------------------------------------------------------
for cmd in gpg gzip; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "SKIP: ${cmd} not found — cannot run GPG encryption tests"
    exit 0
  fi
done

# --- Ephemeral keypair -----------------------------------------------------
PRIV_KEYRING="${WORKDIR}/keyring-private"
PUB_KEYRING="${WORKDIR}/keyring-public"
mkdir -p "${PRIV_KEYRING}" "${PUB_KEYRING}"
chmod 700 "${PRIV_KEYRING}" "${PUB_KEYRING}"

RECIPIENT="backup-test@anchorpoint.invalid"

gpg --homedir "${PRIV_KEYRING}" --batch --pinentry-mode loopback \
  --passphrase '' --gen-key <<'GNUPG' >/dev/null 2>&1
%no-protection
Key-Type: RSA
Key-Length: 2048
Subkey-Type: RSA
Subkey-Length: 2048
Name-Real: AnchorPoint Backup Test
Name-Email: backup-test@anchorpoint.invalid
Expire-Date: 0
%commit
GNUPG

FPR="$(gpg --homedir "${PRIV_KEYRING}" --batch --with-colons \
  --list-keys "${RECIPIENT}" | awk -F: '/^fpr/{print $10; exit}')"
if [[ -z "${FPR}" ]]; then
  echo "FATAL: could not determine test key fingerprint"
  exit 1
fi

# Public-only keyring: export pub key, import into fresh home. The secret
# key never leaves PRIV_KEYRING.
gpg --homedir "${PRIV_KEYRING}" --batch --export "${FPR}" \
  > "${WORKDIR}/backup-public-key.gpg"
gpg --homedir "${PUB_KEYRING}" --batch --import \
  "${WORKDIR}/backup-public-key.gpg" >/dev/null 2>&1

# --- Mock environment ------------------------------------------------------
FAKE_BIN="${WORKDIR}/bin"
mkdir -p "${FAKE_BIN}"
cat > "${FAKE_BIN}/pg_dump" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' '-- mocked pg_dump output' 'CREATE TABLE users (id int);' 'INSERT INTO users VALUES (1);'
FAKE
chmod +x "${FAKE_BIN}/pg_dump"

BACKUP_DIR="${WORKDIR}/backups"

run_backup() {
  env \
    PATH="${FAKE_BIN}:${PATH}" \
    DATABASE_URL="postgresql://u:p@localhost/db" \
    BACKUP_DIR="${BACKUP_DIR}" \
    BACKUP_RETENTION="14" \
    GPG_RECIPIENT="${RECIPIENT}" \
    GPG_KEYRING="${PUB_KEYRING}" \
    "${BACKUP_SCRIPT}" "$@"
}

echo "== test: encrypted backup decrypts with private key =="
if run_backup > "${WORKDIR}/run1.log" 2>&1; then
  enc_files=("${BACKUP_DIR}"/anchorpoint-*.sql.gz.gpg)
  if [[ -f "${enc_files[0]}" ]]; then
    pass "encrypted backup file created"

    # Encrypted blob must not contain plaintext
    if grep -q "CREATE TABLE users" "${enc_files[0]}"; then
      fail "plaintext found inside .gpg file"
    else
      pass "no plaintext in encrypted artifact"
    fi

    # Checksum sidecar exists
    if [[ -f "${enc_files[0]}.sha256" ]]; then
      pass "checksum sidecar written"
    else
      fail "checksum sidecar missing"
    fi

    # Round-trip decrypt + gunzip
    if gpg --homedir "${PRIV_KEYRING}" --batch --pinentry-mode loopback \
        --passphrase '' --decrypt "${enc_files[0]}" 2>/dev/null \
        | gzip -dc > "${WORKDIR}/restored.sql" 2>/dev/null \
      && grep -q "CREATE TABLE users" "${WORKDIR}/restored.sql"; then
      pass "private key decrypts backup to original SQL"
    else
      fail "decryption round-trip failed"
      cat "${WORKDIR}/run1.log"
    fi
  else
    fail "no encrypted backup produced"
    cat "${WORKDIR}/run1.log"
  fi
else
  fail "encrypt-backup.sh exited non-zero"
  cat "${WORKDIR}/run1.log"
fi

echo "== test: script refuses to run when secret key is present =="
BAD_DIR="${WORKDIR}/backups-secret"
if env \
    PATH="${FAKE_BIN}:${PATH}" \
    DATABASE_URL="postgresql://u:p@localhost/db" \
    BACKUP_DIR="${BAD_DIR}" \
    BACKUP_RETENTION="14" \
    GPG_RECIPIENT="${RECIPIENT}" \
    GPG_KEYRING="${PRIV_KEYRING}" \
    "${BACKUP_SCRIPT}" > "${WORKDIR}/secret.log" 2>&1; then
  fail "script should refuse when secret key is in keyring"
else
  if grep -q "Secret key" "${WORKDIR}/secret.log"; then
    pass "script aborts when private key present in keyring"
  else
    fail "aborted but for wrong reason: $(cat "${WORKDIR}/secret.log")"
  fi
fi
if compgen -G "${BAD_DIR}/anchorpoint-*.gpg" > /dev/null; then
  fail "backup artifact written despite secret-key guard"
else
  pass "no backup artifact written on guard failure"
fi

echo "== test: missing DATABASE_URL fails fast =="
if env \
    PATH="${FAKE_BIN}:${PATH}" \
    BACKUP_DIR="${WORKDIR}/backups-nodb" \
    GPG_RECIPIENT="${RECIPIENT}" \
    GPG_KEYRING="${PUB_KEYRING}" \
    "${BACKUP_SCRIPT}" > "${WORKDIR}/nodb.log" 2>&1; then
  fail "script should fail without DATABASE_URL"
else
  pass "missing DATABASE_URL exits non-zero"
fi

echo
if [[ "${failures}" -eq 0 ]]; then
  echo "All encrypt-backup tests passed."
  exit 0
else
  echo "${failures} encrypt-backup test(s) failed."
  exit 1
fi
