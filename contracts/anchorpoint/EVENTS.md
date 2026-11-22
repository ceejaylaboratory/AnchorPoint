# AnchorPoint Contract Administrative Events

This document specifies the typed contract events emitted during administrative parameter changes and state mutations in the `anchorpoint` contract. These events enable off-chain indexers and audit monitors to track protocol governance and parameter updates in real time without polling contract storage.

## Event Summary Table

| Event Topic | Payload Data Type | Emitted When | Description |
|---|---|---|---|
| `admin_chg` | `AdminChanged` (`old_admin`, `new_admin`) | Administrator update | The contract administrator is transitioned to a new address. |
| `fee_upd` | `FeeUpdated` (`asset`, `base_fee`, `rate`) | Fee parameter update | Asset fee schedule (base fee and basis point rate) is updated. |
| `paused` | `ContractPaused` (`()`) | Contract paused | The contract is paused by the administrator, disabling state-mutating operations. |
| `unpaused` | `ContractUnpaused` (`()`) | Contract resumed | Contract operations are unpaused and resumed by the administrator. |
| `relay_chg` | `RelayerChanged` (`old_relayer`, `new_relayer`) | Relayer address update | The trusted relayer address is updated by the administrator. |

---

## Detailed Event Schemas

### 1. `AdminChanged`
Emitted when `set_admin` is called to transfer administrative authority.

- **Topic:** `symbol_short!("admin_chg")`
- **Schema:**
  ```rust
  #[contracttype]
  pub struct AdminChanged {
      pub old_admin: Address,
      pub new_admin: Address,
  }
  ```
- **Index Criteria:** Indexers can filter events where topic `[0]` equals `admin_chg` to monitor ownership transfers.

### 2. `FeeUpdated`
Emitted when `update_fee` or `set_fee` modifies fee schedules or asset configurations.

- **Topic:** `symbol_short!("fee_upd")`
- **Schema:**
  ```rust
  #[contracttype]
  pub struct FeeUpdated {
      pub asset: Address,
      pub base_fee: i128,
      pub rate: u32,
  }
  ```
- **Index Criteria:** Indexers can track parameter changes per asset address or global protocol fees.

### 3. `ContractPaused`
Emitted when `pause` is invoked during maintenance or an emergency.

- **Topic:** `symbol_short!("paused")`
- **Payload:** `()` (empty tuple / `ContractPaused`)
- **Index Criteria:** Topic `[0]` equals `paused`. Immediate alert signal for indexers and dashboards.

### 4. `ContractUnpaused`
Emitted when `unpause` is invoked to resume normal protocol operations.

- **Topic:** `symbol_short!("unpaused")`
- **Payload:** `()` (empty tuple / `ContractUnpaused`)
- **Index Criteria:** Topic `[0]` equals `unpaused`. Clears pause status on dashboards.

### 5. `RelayerChanged`
Emitted when `set_relayer` updates the authorized bridge or execution relayer address.

- **Topic:** `symbol_short!("relay_chg")`
- **Schema:**
  ```rust
  #[contracttype]
  pub struct RelayerChanged {
      pub old_relayer: Address,
      pub new_relayer: Address,
  }
  ```
- **Index Criteria:** Topic `[0]` equals `relay_chg`. Indexers update authorized relayer mapping.
