#![no_std]

pub mod admin;
pub mod rate_limit;
pub mod storage_keys;

#[cfg(test)]
mod tests;

use soroban_sdk::{contracterror, contractimpl, token, Address, Env};

use crate::storage_keys::{ClaimableBalance, DataKey};

/// Explicit error codes replacing generic panics across AnchorPoint contracts.
///
/// Using `#[contracterror]` ensures every error surface is machine-readable
/// (u32 code) and observable in transaction results without parsing raw panic
/// strings.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// Caller is not the authorised admin.
    Unauthorized = 1,
    /// Contract has already been initialised.
    AlreadyInitialized = 2,
    /// The supplied amount is zero or negative.
    InvalidAmount = 3,
    /// The caller's balance is too low for the requested operation.
    InsufficientBalance = 4,
    /// The caller's allowance is too low for the requested operation.
    InsufficientAllowance = 5,
    /// The deposit would push total supply past the configured cap.
    SupplyCapExceeded = 6,
    /// The requested operation is blocked while the contract is paused.
    ContractPaused = 7,
    /// A required storage entry was not found.
    NotInitialized = 8,
    /// The provided batch exceeds the maximum allowed size.
    BatchTooLarge = 9,
    /// The provided batch is empty.
    EmptyBatch = 10,
    /// The claimable balance has already been claimed or clawed back.
    BalanceNotFound = 11,
    /// The claimable balance has expired and can no longer be claimed.
    BalanceExpired = 12,
    /// The claimable balance has not yet expired and cannot be clawed back.
    BalanceNotExpired = 13,
}

#[soroban_sdk::contract]
pub struct AnchorPointContract;

#[contractimpl]
impl AnchorPointContract {
    /// Create a claimable balance escrowing `amount` from `creator` for `claimant`.
    ///
    /// Funds are transferred from `creator` into the contract immediately and
    /// held until the claimant redeems them or the creator claws them back
    /// after `timelock_ledgers` ledgers have elapsed.
    pub fn create_claimable_balance(
        env: Env,
        creator: Address,
        token: Address,
        claimant: Address,
        amount: i128,
        timelock_ledgers: u32,
    ) -> Result<u64, Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        creator.require_auth();

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&creator, &env.current_contract_address(), &amount);

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BalanceCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .instance()
            .set(&DataKey::BalanceCounter, &counter);

        let balance = ClaimableBalance {
            claimant,
            creator,
            amount,
            expiration_ledger: env.ledger().sequence() + timelock_ledgers,
        };
        env.storage()
            .persistent()
            .set(&DataKey::ClaimableBalance(counter), &balance);

        Ok(counter)
    }

    /// Claim a balance. Only the designated claimant may claim, and only
    /// before the balance expires.
    pub fn claim_balance(
        env: Env,
        token: Address,
        balance_id: u64,
        caller: Address,
    ) -> Result<(), Error> {
        caller.require_auth();

        let key = DataKey::ClaimableBalance(balance_id);
        let balance: ClaimableBalance = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::BalanceNotFound)?;

        if caller != balance.claimant {
            return Err(Error::Unauthorized);
        }
        if env.ledger().sequence() > balance.expiration_ledger {
            return Err(Error::BalanceExpired);
        }

        env.storage().persistent().remove(&key);

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &balance.claimant, &balance.amount);

        Ok(())
    }

    /// Reclaim an expired balance. Only the creator may claw back, and only
    /// after the expiration ledger has passed.
    pub fn clawback_expired_balance(
        env: Env,
        token: Address,
        balance_id: u64,
        caller: Address,
    ) -> Result<(), Error> {
        caller.require_auth();

        let key = DataKey::ClaimableBalance(balance_id);
        let balance: ClaimableBalance = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::BalanceNotFound)?;

        if caller != balance.creator {
            return Err(Error::Unauthorized);
        }
        if env.ledger().sequence() <= balance.expiration_ledger {
            return Err(Error::BalanceNotExpired);
        }

        env.storage().persistent().remove(&key);

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &balance.creator, &balance.amount);

        Ok(())
    }
}
