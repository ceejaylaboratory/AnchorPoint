# RandomGen Contract — Storage Limits

## Overview

`RandomGen` implements a commit–reveal random seed ceremony. Each generation stores participant commitments and reveals in **persistent** storage, with protocol state in **instance** storage.

## Storage Layout

| Key | Tier | Value | Notes |
|-----|------|-------|-------|
| `Admin` | instance | `Address` | Set once at init |
| `MinCommits` | instance | `u32` | Required reveals to finalize |
| `Phase` | instance | `Phase` | Commit → Reveal → Finished |
| `Committers` | instance | `Vec<Address>` | Cleared after finalize |
| `RandomSeed` | instance | `BytesN<32>` | Final XOR-combined seed |
| `Commit(user)` | persistent | `BytesN<32>` | Removed after finalize |
| `Reveal(user)` | persistent | `BytesN<32>` | Removed after finalize |

## Footprint Formula

For `min_commits = N` (capped at `MAX_PARTICIPANTS = 64`):

- **During ceremony:** up to `2 × N` persistent entries + `Committers` vec (N addresses)
- **After finalize:** only `RandomSeed`, `Phase`, `Admin`, and `MinCommits` remain in instance storage; ephemeral persistent keys are removed

Worst-case persistent bytes for user data: `N × PERSISTENT_BYTES_PER_PARTICIPANT` (64 bytes per participant during the ceremony).

## Operator Guidance

- Set `min_commits` between `1` and `64`. Values above `MAX_PARTICIPANTS` are rejected at initialization.
- Treat each deployment as a **one-shot** ceremony; redeploy for a new generation.
- Indexers should consume `commit`, `reveal`, and `rng_fin` events rather than scanning all persistent keys.

## Audit Notes (Issue #573)

1. **Bounded participants** — `MAX_PARTICIPANTS` prevents rent/footprint DoS via unbounded `min_commits`.
2. **Post-finalize cleanup** — commit/reveal persistent entries and the `Committers` vec are removed after seed generation.
3. **Redundant storage** — `Committers` duplicates addresses already keyed in persistent storage; kept for finalize iteration but cleared after use.
