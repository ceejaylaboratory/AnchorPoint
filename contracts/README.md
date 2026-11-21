# Contracts

This directory contains the Soroban smart contracts that power the Handsoff protocol.

## Authorization model

All administrative entry points enforce authorization through the Soroban host via
`admin.require_auth()`. Manual address comparisons (for example `caller == admin`)
are **not** used for authorization because they do not verify signatures and bypass
host-level authentication.

### Requirements

- **Admin setters** (configuration, fee, and role management) call
  `admin.require_auth()` before mutating state. Unauthorized invocations fail host
authentication before the function body executes.
- **Multisig accounts** are honored automatically: when the stored admin is a
  multisig account, `require_auth()` delegates to the host, which enforces the
  account's configured signature threshold.
- **User-scoped operations** call `require_auth()` on the acting address (e.g. the
  depositor or borrower) so that only the signer can move their own funds.

### Public method authorization

| Contract | Method | Authorization |
| --- | --- | --- |
| governance | `initialize` | `admin.require_auth()` |
| governance | `set_admin` / config setters | `admin.require_auth()` |
| governance | `propose` / `vote` | acting address `require_auth()` |

When adding a new entry point, call `require_auth()` on the relevant address at the
top of the function and add a test that asserts unauthorized callers are rejected.
