# Yield Distribution & ERC-4626 Strategy Vault Events

| Event topic | Data | Emitted when |
| --- | --- | --- |
| `sec_reg` | `registry` | A security registry is configured. |
| `init` | `(admin, stake_token, reward_token)` | Distribution is initialized. |
| `dep_rwd`, `staked`, `unstaked` | User and amount values | Reward funds or stake balances change. |
| `claimed` | `(user, reward)` | Reward accounting is updated, including zero-reward claims. |
| `deposit` | `(assets, shares_minted)` | User deposits assets into the ERC-4626 vault and receives shares. |
| `mint` | `(shares, assets_needed)` | User mints exact shares in the ERC-4626 vault. |
| `redeem` | `(shares, assets_returned)` | User redeems vault shares for proportional underlying assets. |
| `withdraw` | `(assets, shares_burned)` | User withdraws exact underlying assets by burning vault shares. |
| `dep_yield` | `amount` | Unharvested yield tokens are deposited into the vault. |
| `harvest` | `(gross_yield, perf_fee, caller_bounty, net_yield)` | Compounding harvest executed with fee and bounty distribution. |
| `rev_dist` | `distributor` | Revenue distributor address configured by admin. |
| `stk_pool` | `pool` | Underlying staking pool address configured by admin. |
| `fees_set` | `(performance_fee_bps, caller_bounty_bps)` | Harvest performance fee and caller bounty configured by admin. |
