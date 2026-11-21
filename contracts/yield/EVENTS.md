# Yield Distribution Events

| Event topic | Data | Emitted when |
| --- | --- | --- |
| `sec_reg` | `registry` | A security registry is configured. |
| `init` | `(admin, stake_token, reward_token)` | Distribution is initialized. |
| `dep_rwd`, `staked`, `unstaked` | User and amount values | Reward funds or stake balances change. |
| `claimed` | `(user, reward)` | Reward accounting is updated, including zero-reward claims. |
| `vlt_cfg` | `(asset, revenue_distributor, performance_fee_bps, caller_bounty_bps)` | The auto-compounding vault is configured. |
| `vlt_src` | `source` | An underlying yield source is configured for the vault. |
| `vlt_fee` | `(performance_fee_bps, caller_bounty_bps)` | Vault fee split is updated by the admin. |
| `vlt_dep` | `(user, assets, shares)` | Assets are deposited and vault shares are minted. |
| `vlt_mnt` | `(user, assets, shares)` | An exact number of vault shares is minted. |
| `vlt_wdr` | `(user, assets, shares)` | Assets are withdrawn and the proportional shares are burned. |
| `vlt_rdm` | `(user, assets, shares)` | Vault shares are redeemed for assets. |
| `harvest` | `(caller, yield_amount, net, performance_fee, caller_bounty)` | Yield is harvested, fees are paid, and the remainder is reinvested. |
