#![no_std]

pub mod admin;
pub mod events;
pub mod rate_limit;
pub mod storage_keys;

#[cfg(test)]
mod tests;

use admin::Admin;
use soroban_sdk::{contract, contracterror, contractimpl, Address, Env};

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
}

#[contract]
pub struct AnchorPointContract;

#[contractimpl]
impl AnchorPointContract {
    pub fn update_oracle(env: Env, admin: Address, feed_id: u32, price: i128) -> Result<(), Error> {
        Admin::update_oracle(env, admin, feed_id, price)
    }

    pub fn set_fee(env: Env, admin: Address, new_fee: u32) -> Result<(), Error> {
        Admin::set_fee(env, admin, new_fee)
    }

    pub fn update_fee(
        env: Env,
        admin: Address,
        asset: Address,
        base_fee: i128,
        rate: u32,
    ) -> Result<(), Error> {
        Admin::update_fee(env, admin, asset, base_fee, rate)
    }

    pub fn set_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), Error> {
        Admin::set_admin(env, current_admin, new_admin)
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        Admin::pause(env, admin)
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        Admin::unpause(env, admin)
    }

    pub fn set_relayer(env: Env, admin: Address, new_relayer: Address) -> Result<(), Error> {
        Admin::set_relayer(env, admin, new_relayer)
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        Admin::get_admin(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        Admin::is_paused(&env)
    }

    pub fn get_relayer(env: Env) -> Option<Address> {
        Admin::get_relayer(&env)
    }

    pub fn get_fee(env: Env, asset: Address) -> Option<storage_keys::FeeConfig> {
        Admin::get_fee(&env, asset)
    }
}
