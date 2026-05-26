#![no_std]

pub mod admin;
pub mod rate_limit;
pub mod storage_keys;

#[cfg(test)]
mod tests;

#[soroban_sdk::contract]
pub struct AnchorPointContract;
