use soroban_sdk::{symbol_short, Address, ConversionError, Env, IntoVal, Symbol, TryFromVal, Val};

pub const TOPIC_ADMIN_CHANGED: Symbol = symbol_short!("admin_chg");
pub const TOPIC_FEE_UPDATED: Symbol = symbol_short!("fee_upd");
pub const TOPIC_CONTRACT_PAUSED: Symbol = symbol_short!("paused");
pub const TOPIC_CONTRACT_UNPAUSED: Symbol = symbol_short!("unpaused");
pub const TOPIC_RELAYER_CHANGED: Symbol = symbol_short!("relay_chg");

/// Event emitted when the administrator address is updated.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    pub old_admin: Address,
    pub new_admin: Address,
}

/// Event emitted when fee parameters for an asset are updated.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeUpdated {
    pub asset: Address,
    pub base_fee: i128,
    pub rate: u32,
}

/// Event emitted when the contract is paused.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ContractPaused;

impl IntoVal<Env, Val> for ContractPaused {
    fn into_val(&self, env: &Env) -> Val {
        ().into_val(env)
    }
}

impl TryFromVal<Env, Val> for ContractPaused {
    type Error = ConversionError;
    fn try_from_val(env: &Env, val: &Val) -> Result<Self, Self::Error> {
        let () = <()>::try_from_val(env, val)?;
        Ok(ContractPaused)
    }
}

/// Event emitted when the contract is unpaused.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ContractUnpaused;

impl IntoVal<Env, Val> for ContractUnpaused {
    fn into_val(&self, env: &Env) -> Val {
        ().into_val(env)
    }
}

impl TryFromVal<Env, Val> for ContractUnpaused {
    type Error = ConversionError;
    fn try_from_val(env: &Env, val: &Val) -> Result<Self, Self::Error> {
        let () = <()>::try_from_val(env, val)?;
        Ok(ContractUnpaused)
    }
}

/// Event emitted when the authorized relayer address is updated.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RelayerChanged {
    pub old_relayer: Address,
    pub new_relayer: Address,
}

/// Helper function to emit the `AdminChanged` event.
pub fn emit_admin_changed(env: &Env, old_admin: &Address, new_admin: &Address) {
    let event = AdminChanged {
        old_admin: old_admin.clone(),
        new_admin: new_admin.clone(),
    };
    env.events().publish((TOPIC_ADMIN_CHANGED,), event);
}

/// Helper function to emit the `FeeUpdated` event.
pub fn emit_fee_updated(env: &Env, asset: &Address, base_fee: i128, rate: u32) {
    let event = FeeUpdated {
        asset: asset.clone(),
        base_fee,
        rate,
    };
    env.events().publish((TOPIC_FEE_UPDATED,), event);
}

/// Helper function to emit the `ContractPaused` event.
pub fn emit_contract_paused(env: &Env) {
    env.events()
        .publish((TOPIC_CONTRACT_PAUSED,), ContractPaused);
}

/// Helper function to emit the `ContractUnpaused` event.
pub fn emit_contract_unpaused(env: &Env) {
    env.events()
        .publish((TOPIC_CONTRACT_UNPAUSED,), ContractUnpaused);
}

/// Helper function to emit the `RelayerChanged` event.
pub fn emit_relayer_changed(env: &Env, old_relayer: &Address, new_relayer: &Address) {
    let event = RelayerChanged {
        old_relayer: old_relayer.clone(),
        new_relayer: new_relayer.clone(),
    };
    env.events().publish((TOPIC_RELAYER_CHANGED,), event);
}
