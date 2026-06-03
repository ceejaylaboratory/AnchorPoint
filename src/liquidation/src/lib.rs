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
    OracleId,    // Address of the Oracle contract
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
        
        id = id.checked_add(1).expect("vault id overflow");

        id += 1;
        env.storage().instance().set(&DataKey::NextVaultId, &id);
        id - 1
    }

    pub fn liquidate(env: Env, liquidator: Address, vault_id: u32) {
        liquidator.require_auth();
        let mut vault: Vault = env
            .storage()
            .persistent()
            .get(&DataKey::Vaults(vault_id))
            .expect("vault not found");

        let oracle_id: Address = env.storage().instance().get(&DataKey::OracleId).unwrap();

        // Fetch collateral price from oracle
        // Assume oracle has `fn get_price(env: Env) -> u128` (price in e.g. 7 decimals)
        let collateral_price: u128 = env.invoke_contract(&oracle_id, &symbol_short!("get_price"), soroban_sdk::vec![&env]);
        
        let collateral_value = vault.collateral_amount.checked_mul(collateral_price).expect("value overflow");
        // Assume debt is represented in same base units. Health factor * 100
        let health_factor = collateral_value.checked_mul(100).expect("health factor overflow") / vault.debt_amount;
        
        let collateral_price: u128 = env.invoke_contract(
            &oracle_id,
            &symbol_short!("get_price"),
            soroban_sdk::vec![&env],
        );

        let collateral_value = vault.collateral_amount * collateral_price;
        // Assume debt is represented in same base units. Health factor * 100
        let health_factor = (collateral_value * 100) / vault.debt_amount;

        assert!(health_factor < 120, "vault is healthy"); // 120% min health factor

        // Liquidator incentive: 5% spread + 10 units fixed fee
        let incentive = vault.collateral_amount.checked_mul(5).expect("incentive overflow") / 100 + 10;
        let liquidated_collateral = vault.collateral_amount;
        
        let incentive = (vault.collateral_amount * 5) / 100 + 10;
        let _liquidated_collateral = vault.collateral_amount;

        vault.collateral_amount = 0;
        vault.debt_amount = 0; // Assume debt fully cleared by liquidation
        
        env.storage().persistent().set(&DataKey::Vaults(vault_id), &vault);
        
        // Topic: event name only; vault_id (u32) + liquidator + incentive in data.
        env.events().publish(
            symbol_short!("liquidate"),
            (vault_id, liquidator, incentive),

        env.storage()
            .persistent()
            .set(&DataKey::Vaults(vault_id), &vault);

        // Emit liquidation event with the liquidator and incentive
        env.events().publish(
            (symbol_short!("liquidate"), vault_id, liquidator),
            incentive,
        );
    }

    /// Partially liquidates a vault, reducing market impact and improving systemic stability.
    /// liquidate_amount: The amount of debt to repay through partial liquidation.
    pub fn partial_liquidate(env: Env, liquidator: Address, vault_id: u32, liquidate_amount: u128) {
        liquidator.require_auth();
        let mut vault: Vault = env.storage().persistent().get(&DataKey::Vaults(vault_id)).expect("vault not found");
        
        assert!(liquidate_amount > 0, "liquidate amount must be positive");
        assert!(liquidate_amount <= vault.debt_amount, "cannot liquidate more than debt");
        
        let oracle_id: Address = env.storage().instance().get(&DataKey::OracleId).unwrap();
        
        // Fetch collateral price from oracle
        let collateral_price: u128 = env.invoke_contract(&oracle_id, &symbol_short!("get_price"), soroban_sdk::vec![&env]);
        
        let collateral_value = vault.collateral_amount * collateral_price;
        let health_factor = (collateral_value * 100) / vault.debt_amount;
        
        // Allow partial liquidation for vaults below 150% health factor (less strict than full liquidation)
        assert!(health_factor < 150, "vault is healthy for partial liquidation");
        
        // Calculate collateral to liquidate proportional to debt being repaid
        let collateral_ratio = vault.collateral_amount / vault.debt_amount;
        let collateral_to_liquidate = liquidate_amount * collateral_ratio;
        
        // Liquidator incentive: 3% spread for partial liquidations (lower incentive than full)
        let incentive = (collateral_to_liquidate * 3) / 100;
        
        // Update vault
        vault.collateral_amount -= collateral_to_liquidate + incentive;
        vault.debt_amount -= liquidate_amount;
        
        env.storage().persistent().set(&DataKey::Vaults(vault_id), &vault);
        
        // Emit partial liquidation event
        env.events().publish(
            (symbol_short!("partial_liquidate"), vault_id, liquidator), 
            (liquidate_amount, collateral_to_liquidate, incentive)
        );
    }
}
