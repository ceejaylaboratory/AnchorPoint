# Soroban Security Audit

Automated security checks for AnchorPoint Soroban contracts run on every Rust CI build.

## What runs

The [`scripts/security-audit.sh`](../scripts/security-audit.sh) script performs:

1. **Wasm build** — `cargo build --target wasm32-unknown-unknown --release` for the root and `contracts/` workspaces.
2. **Scout static analysis** — [CoinFabrik Scout](https://coinfabrik.github.io/scout-soroban/docs/intro) (`cargo scout-audit`) scans Rust sources for Soroban security detectors.
3. **Wasm artifact checks** — Validates `.wasm` magic headers and optionally runs `soroban-analyzer` when that binary is available in `PATH`.
4. **Source pattern review** — Warns on `unsafe` blocks, `env.panic`, and unprotected `update_current_contract_wasm` references.

## Local usage

Install Scout:

```bash
cargo install cargo-scout-audit
```

On Linux CI hosts, Scout may also require:

```bash
sudo apt-get install -y libssl-dev pkg-config gcc
```

Run the audit from the repository root:

```bash
./scripts/security-audit.sh
```

Skip the build step if Wasm artifacts are already present:

```bash
./scripts/security-audit.sh --skip-build
```

Treat warnings as non-fatal (Scout failures still fail the run):

```bash
./scripts/security-audit.sh --warn-only
```

## CI integration

The [Rust Contracts workflow](../.github/workflows/rust.yml) runs this script after contract tests. A failing audit blocks the workflow.

## Manual QA checklist

1. Install `cargo-scout-audit` locally.
2. Run `./scripts/security-audit.sh` from the repo root.
3. Confirm Scout output lists analyzed crates and completes without critical findings.
4. Open `target/wasm32-unknown-unknown/release/*.wasm` paths printed by the script and verify files exist after a successful build.
5. Push a branch and confirm the **Run Security Audit** step passes in GitHub Actions.

## Optional: soroban-analyzer

The issue references tools *like* `soroban-analyzer`. If you install a compatible Wasm analyzer binary named `soroban-analyzer`, the script will invoke it on each discovered artifact automatically. Scout remains the primary static analyzer for Rust sources.
