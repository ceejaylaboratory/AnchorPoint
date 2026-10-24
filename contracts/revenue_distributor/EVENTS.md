# Revenue Distributor Events

| Event topic | Data | Emitted when |
| --- | --- | --- |
| `dist_init` | `(admin, treasury, gov_stakers, gov_share_bps)` | The distributor is initialized. |
| `shares`, `admin` | `gov_share_bps` | The distribution split changes. |
| `token_reg` | `(admin, token)` | A payout token is newly registered. |
| `set_cap` | `cap` | The deposit cap changes. |
| Existing `deposit`, distribution, and sweep events | See `src/lib.rs` | Deposits or payouts complete. |
| `sweep_add` | `(admin, operator)` | A sweep operator is added. |
| `sweep_rm` | `(admin, operator)` | A sweep operator is removed. |
