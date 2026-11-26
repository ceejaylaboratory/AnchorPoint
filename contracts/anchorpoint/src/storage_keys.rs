use soroban_sdk::{contracttype, Address};

/// Storage keys for the AnchorPoint contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Admin address.
    Admin,
    /// A claimable balance entry keyed by its unique id.
    ClaimableBalance(u64),
    /// Monotonic counter used to allocate claimable balance ids.
    BalanceCounter,
}

/// A claimable balance held in escrow until claimed or clawed back.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimableBalance {
    /// The address authorised to claim the funds.
    pub claimant: Address,
    /// The address that created the balance and may claw it back after expiry.
    pub creator: Address,
    /// The amount held in escrow.
    pub amount: i128,
    /// Ledger sequence after which the creator may reclaim the funds.
    pub expiration_ledger: u32,
}
