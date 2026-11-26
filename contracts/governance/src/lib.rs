#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, contracterror, symbol_short, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Phase {
    Draft,
    Active,
    QuorumReached,
    ExecutionPending,
    Executed,
    Defeated,
    Cancelled,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum GovernanceError {
    QuorumNotReached = 1,
    VotingClosed = 2,
    AlreadyVoted = 3,
    InvalidPhase = 4,
    InsufficientSignatures = 5,
    UnauthorizedSigner = 6,
    DuplicateSigner = 7,
    CyclicalDelegation = 8,
    SelfDelegation = 9,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub title: String,
    pub votes_yes: u64,
    pub votes_no: u64,
    pub votes_abstain: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Proposal(u32),
    Admin,
    CouncilSigners,
    Threshold,
    Delegate(Address),
}

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn initialize(env: Env, admin: Address, _quorum_threshold: u64, _voting_duration: u64) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.events()
            .publish((symbol_short!("gov_init"),), admin);
    }

    /// Configure the vector of governance council address signers and required threshold (M of N).
    pub fn set_council(env: Env, admin: Address, signers: Vec<Address>, threshold: u32) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        assert!(threshold > 0 && threshold <= signers.len(), "invalid threshold");
        env.storage().instance().set(&DataKey::CouncilSigners, &signers);
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("council")),
            (admin, signers, threshold),
        );
    }

    /// Get configured council signers.
    pub fn get_council_signers(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::CouncilSigners).unwrap_or(Vec::new(&env))
    }

    /// Get required threshold of signatures.
    pub fn get_threshold(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Threshold).unwrap_or(0)
    }

    pub fn transfer_admin(env: Env, admin: Address, new_admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("transfer")),
            (admin, new_admin),
        );
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).expect("admin not set")
    }

    pub fn create_proposal(env: Env, creator: Address, title: String) -> u32 {
        let prop_id: u32 = 0;
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("proposed")),
            (creator, prop_id, title),
        );
        prop_id
    }

    /// Delegate voting power from `delegator` to `delegatee`.
    /// Rejects self-delegation and cyclical delegation chains.
    pub fn delegate_votes(env: Env, delegator: Address, delegatee: Address) -> Result<(), GovernanceError> {
        delegator.require_auth();

        if delegator == delegatee {
            return Err(GovernanceError::SelfDelegation);
        }

        // Walk the existing delegation chain from the delegatee to detect cycles.
        let mut cursor = delegatee.clone();
        let mut hops: u32 = 0;
        loop {
            if cursor == delegator {
                return Err(GovernanceError::CyclicalDelegation);
            }
            match env.storage().persistent().get::<DataKey, Address>(&DataKey::Delegate(cursor.clone())) {
                Some(next) => {
                    cursor = next;
                    hops += 1;
                    if hops > 64 {
                        return Err(GovernanceError::CyclicalDelegation);
                    }
                }
                None => break,
            }
        }

        env.storage().persistent().set(&DataKey::Delegate(delegator.clone()), &delegatee);
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("delegate")),
            (delegator, delegatee),
        );
        Ok(())
    }

    /// Revoke any active delegation for `delegator`.
    pub fn revoke_delegation(env: Env, delegator: Address) {
        delegator.require_auth();
        env.storage().persistent().remove(&DataKey::Delegate(delegator.clone()));
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("revoke")),
            (delegator,),
        );
    }

    /// Return the current delegatee for `delegator`, if any.
    pub fn get_delegate(env: Env, delegator: Address) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Delegate(delegator))
    }

    pub fn vote(env: Env, caller: Address, prop_id: u32, support: bool, weight: u64) {
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("voted")),
            (caller, prop_id, support, weight),
        );
    }

    /// Cast a vote using quadratic voting power derived from `staked_tokens`.
    /// Voting weight is `sqrt(staked_tokens)`, mitigating whale dominance.
    pub fn vote_quadratic(env: Env, caller: Address, prop_id: u32, support: bool, staked_tokens: u64) {
        caller.require_auth();
        let weight = ProposalMath::quadratic_weight(staked_tokens);
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("voted")),
            (caller, prop_id, support, weight),
        );
    }

    /// Execute proposal with multi-sig threshold authorization checks.
    /// Collects signers and verifies valid weight/quorum threshold satisfies requirements.
    pub fn execute_proposal(env: Env, prop_id: u32, signers: Vec<Address>) -> Result<(), GovernanceError> {
        let threshold: u32 = env.storage().instance().get(&DataKey::Threshold).unwrap_or(0);
        let council: Vec<Address> = env.storage().instance().get(&DataKey::CouncilSigners).unwrap_or(Vec::new(&env));

        if threshold > 0 {
            if signers.len() < threshold {
                return Err(GovernanceError::InsufficientSignatures);
            }

            let mut valid_weight: u32 = 0;
            let mut verified_signers: Vec<Address> = Vec::new(&env);

            for i in 0..signers.len() {
                let signer = signers.get(i).unwrap();
                signer.require_auth();

                // Verify signer is a registered council member
                let mut is_council = false;
                for j in 0..council.len() {
                    if council.get(j).unwrap() == signer {
                        is_council = true;
                        break;
                    }
                }
                if !is_council {
                    return Err(GovernanceError::UnauthorizedSigner);
                }

                // Verify no duplicate signers
                for k in 0..verified_signers.len() {
                    if verified_signers.get(k).unwrap() == signer {
                        return Err(GovernanceError::DuplicateSigner);
                    }
                }
                verified_signers.push_back(signer);
                valid_weight += 1;
            }

            if valid_weight < threshold {
                return Err(GovernanceError::InsufficientSignatures);
            }
        }

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("executed")),
            (prop_id,),
        );
        Ok(())
    }

    pub fn execute(env: Env, prop_id: u32) -> Result<(), GovernanceError> {
        Self::execute_proposal(env, prop_id, Vec::new(&env))
    }

    pub fn cancel(env: Env, admin: Address, prop_id: u32) {
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("cancelled")),
            (admin, prop_id),
        );
    }
}

pub fn get_phase(_env: Env, _prop_id: u32) -> Phase { Phase::Draft }

pub struct ProposalMath;
impl ProposalMath {
    pub fn calculate_total_weight(a: u64, b: u64) -> Result<u64, ()> { a.checked_add(b).ok_or(()) }
    pub fn calculate_quorum(total: u64, bps: u32) -> Result<u64, ()> {
        if bps > 10000 { return Err(()); }
        let total_u128 = total as u128;
        let bps_u128 = bps as u128;
        let result = (total_u128 * bps_u128) / 10000;
        if result > u64::MAX as u128 { return Err(()); }
        Ok(result as u64)
    }
    pub fn calculate_deadline(start: u32, duration: u32) -> Result<u32, ()> { start.checked_add(duration).ok_or(()) }

    /// Integer square root of `n` (floor). Used for quadratic voting weight.
    pub fn sqrt(n: u64) -> u64 {
        if n < 2 {
            return n;
        }
        let mut x = n;
        let mut y = (x + 1) / 2;
        while y < x {
            x = y;
            y = (x + n / x) / 2;
        }
        x
    }

    /// Quadratic voting weight: `sqrt(staked_tokens)`.
    pub fn quadratic_weight(staked_tokens: u64) -> u64 {
        Self::sqrt(staked_tokens)
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
pub mod tests;
