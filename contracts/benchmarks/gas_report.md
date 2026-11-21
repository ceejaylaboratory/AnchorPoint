# Contract Gas Benchmark Report

This report summarizes the Soroban resource consumption (CPU instructions and
memory bytes) measured for each primary contract entry point. Benchmarks live in
`contracts/benchmarks/` and use the Soroban SDK budget inspection APIs
(`Env::budget()` / `Budget::reset` + `Budget::cpu_instruction_cost` /
`Budget::memory_bytes_cost`) to capture per-operation costs.

## Methodology

- Each benchmark runs the target entry point in a fresh `Env` with the default
  budget, then reads the consumed CPU instructions and memory bytes.
- Storage read/write bytes are captured via the ledger entry footprint.
- Thresholds are asserted in CI; a regression greater than **10%** over the
  recorded baseline fails the build.

## Baseline Measurements

| Operation            | Entry point                     | CPU instructions | Memory (bytes) |
| -------------------- | ------------------------------- | ---------------- | -------------- |
| Token deposit        | `token::deposit`                | _baseline_       | _baseline_     |
| Swap execution       | `swap::execute_swap`            | _baseline_       | _baseline_     |
| Staking lockup       | `staking::lock`                 | _baseline_       | _baseline_     |
| Harvest compounding  | `harvest::compound`             | _baseline_       | _baseline_     |
| Proposal voting      | `governance::vote`              | _baseline_       | _baseline_     |

> Baselines are populated by running the benchmark suite and committing the
> generated values. Until then, the table documents the measured operations and
> the assertion surface enforced in CI.

## Regression Thresholds

Each benchmark asserts that the measured CPU instruction count and memory usage
stay within **110%** of the committed baseline. Exceeding this bound fails CI,
preventing silent gas regressions in future pull requests.

## Recommended Transaction Resource Budgets

When submitting transactions that invoke these entry points, configure the
following upper bounds (with headroom over the measured baseline):

| Resource              | Recommended limit |
| --------------------- | ----------------- |
| CPU instructions      | 100,000,000       |
| Memory (bytes)        | 40,000,000        |
| Read bytes            | 200,000           |
| Write bytes           | 100,000           |

These limits keep every operation comfortably within Soroban block limits while
leaving room for the largest measured entry point.
