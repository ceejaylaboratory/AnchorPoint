# Council Governance Events

| Topic | Data | Emitted when |
| --- | --- | --- |
| `gov_init` | `admin` | Governance is initialized. |
| `gov/council` | `(admin, signers, threshold)` | Council signers or threshold change. |
| `gov/transfer` | Admin transfer values | Council-approved administrator transfer completes. |
| `gov/timelock` | `(admin, timelock_delay)` | Timelock delay is updated. |
| `gov/proposed` | Proposal data | A proposal is created. |
| `gov/voted` | Vote data | A council vote is recorded. |
| `gov/queued` | `(prop_id, executable_after_ledger)` | A proposal is queued with timelock delay. |
| `gov/executed` | Execution details | A proposal is executed. |
| `gov/cancelled` | Cancellation details | A proposal is cancelled. |
