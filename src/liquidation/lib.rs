#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

#[contracttype]
pub struct Vault {
    pub owner: Address,
    pub collateral_amount: u128,
    pub debt_amount: u128,
}

#[contracttype]
pub enum DataKey {
    Vaults(u32), // Vault ID
    OracleId, // Address of the Oracle contract
    NextVaultId,
}

#[contract]
pub struct LiquidationEngine;

#[contractimpl]
impl LiquidationEngine {
    pub fn initialize(env: Env, oracle_id: Address) {
        if env.storage().instance().has(&DataKey::OracleId) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::OracleId, &oracle_id);
        env.storage().instance().set(&DataKey::NextVaultId, &1u32);
    }

    pub fn create_vault(env: Env, owner: Address, collateral: u128, debt: u128) -> u32 {
        owner.require_auth();
        let mut id: u32 = env.storage().instance().get(&DataKey::NextVaultId).unwrap();
        
        let vault = Vault {
            owner: owner.clone(),
            collateral_amount: collateral,
            debt_amount: debt,
        };
        env.storage().persistent().set(&DataKey::Vaults(id), &vault);
        
        id += 1;
        env.storage().instance().set(&DataKey::NextVaultId, &id);
        id - 1
    }

    pub fn liquidate(env: Env, liquidator: Address, vault_id: u32) {
        liquidator.require_auth();
        let mut vault: Vault = env.storage().persistent().get(&DataKey::Vaults(vault_id)).expect("vault not found");
        
        let oracle_id: Address = env.storage().instance().get(&DataKey::OracleId).unwrap();
        
        // Fetch collateral price from oracle
        // Assume oracle has `fn get_price(env: Env) -> u128` (price in e.g. 7 decimals)
        let collateral_price: u128 = env.invoke_contract(&oracle_id, &symbol_short!("get_price"), soroban_sdk::vec![&env]);
        
        let collateral_value = vault.collateral_amount * collateral_price;
        // Assume debt is represented in same base units. Health factor * 100
        let health_factor = (collateral_value * 100) / vault.debt_amount;
        
        assert!(health_factor < 120, "vault is healthy"); // 120% min health factor
        
        // Liquidator incentive: 5% spread + 10 units fixed fee
        let incentive = (vault.collateral_amount * 5) / 100 + 10;
        let liquidated_collateral = vault.collateral_amount;
        
        vault.collateral_amount = 0;
        vault.debt_amount = 0; // Assume debt fully cleared by liquidation
        
        env.storage().persistent().set(&DataKey::Vaults(vault_id), &vault);
        
        // Topic: event name only; vault_id (u32) + liquidator + incentive in data.
        env.events().publish(
            symbol_short!("liquidate"),
            (vault_id, liquidator, incentive),
        );
    }
}
