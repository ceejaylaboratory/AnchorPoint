# Rate Limiting Architecture

## Architecture Overview
The AnchorPoint platform implements rate limiting for all sensitive administrative actions. We use **Option A — Per-action cooldown map**, meaning each distinct action type maintains an independent cooldown timer. This allows administrators to perform concurrent distinct operations (e.g., updating an oracle feed and pausing a compromised asset) without arbitrary contention, which is essential during high-volatility events.

By default, the actions have the following cooldowns:
- `UpdateOracle`: 60 seconds (requires relatively frequent updates)
- `SetFee`: 30 minutes (mitigates erratic fee fluctuations)
- `AddAsset`: 1 hour (deliberate action requiring awareness)
- `RemoveAsset`: 24 hours (high impact action; requires maximum notice)
- `UpdateAdmin`: 24 hours (critical security action)

## Sequence Diagram
```text
Admin User                      RateLimiter                     Storage
    |                                |                             |
    |---- 1. call set_fee() -------->|                             |
    |                                |-- 2. get_last_called() ---->|
    |                                |<----- last_called ----------|
    |                                |                             |
    |                                |-- 3. check time elapsed     |
    |                                |                             |
    | [if elapsed]                   |                             |
    |                                |-- 4. set(current_time) ---->|
    |<--- 5. Ok(()) -----------------|                             |
    |                                |                             |
    | [if NOT elapsed]               |                             |
    |<--- 5. Err(CooldownNotElapsed)-|                             |
```

## Security Properties
- **Timestamp Manipulation:** Soroban ledger timestamps are provided by consensus among Stellar validators. While slight clock drift between validators is possible, a drift of ±N seconds is acceptable. The cooldown provides a mathematical bound on execution frequency rather than absolute sub-second precision.
- **Action Aliasing Prevention:** Storage keys are strongly typed using the `DataKey::ActionCooldown(ActionType)` enum. Soroban's XDR serialization ensures that different enum variants inherently map to distinct binary representations. This deterministic isolation mathematically prevents alias attacks where one action overwrites the cooldown of another. No magic strings or manual concatenations are used.
- **Admin Key Compromise During Lockout:** Rate limiting does not replace robust authentication, but it operates as a distinct security layer. If the admin key is compromised while a cooldown is active, the attacker cannot bypass the timer. They must wait out the lockout window, providing the DAO or guardians a critical period to freeze the protocol or rotate the admin key.
- **Cooldown Misconfiguration:** The contract enforces a strict `MIN_COOLDOWN` constant of 10 seconds within the `set_cooldown` function. It is impossible to set a cooldown to zero or any value that effectively bypasses the rate limiting logic.

## Operator Runbook
- **Adjusting Cooldowns:** Cooldowns can be dynamically adjusted by calling `set_cooldown` (assuming an admin governance wrapper exposes this). 
- **Governance Process:** Adjusting rate-limit timers should pass through the protocol's multisig. Lowering cooldowns should be heavily scrutinized, as it directly reduces the available intervention window during an attack.

## Known Limitations and Edge Cases
- **Initial Strike:** Rate limiting slows down a malicious actor but does not prevent the first unauthorized action. If the attacker compromises the key while timers are clear, they immediately get one "free" execution per action type before being locked out.
- **Operator Friction:** A legitimate admin invoking an action with incorrect parameters (e.g., typos in `UpdateOracle`) will be forced to wait out the entire cooldown period before they can correct their mistake.
