# Contracts

Soroban contracts in this workspace (`contracts/Cargo.toml`). The root
workspace (`Cargo.toml`, crates under `src/`) is built by the same CI workflow.

## CI caching

`.github/workflows/rust.yml` uses [`Swatinem/rust-cache@v2`](https://github.com/Swatinem/rust-cache)
in both the `rust-checks` and `mutation-testing` jobs.

**What is cached**

- `~/.cargo/registry` (index and downloaded crates)
- `~/.cargo/git` (git dependencies)
- `target/` for the root workspace and `contracts/target/` for this workspace

**Cache key**

The key is derived from the job, the Rust toolchain version, and a hash of
every `Cargo.toml` and `Cargo.lock` in both workspaces. Changing a dependency
or the toolchain produces a new key, so the next run rebuilds from scratch and
saves a fresh cache.

**Cleanup**

Before saving, the action prunes build artifacts for workspace crates and for
dependencies that are no longer in the dependency graph, so stale artifacts do
not accumulate. `cache-on-failure: true` keeps the dependency cache even when a
later step (e.g. clippy or tests) fails.

**WASM output**

Only intermediate dependency artifacts are restored; workspace crates are
always recompiled, so the release WASM produced by
`cargo build --target wasm32v1-none --release` is the same as an uncached
build.

To force a cold build, delete the caches from the repository's
**Actions → Caches** page or bump the toolchain.
