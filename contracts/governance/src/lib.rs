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

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ProposalStatus {
    Queued,
    Executed,
    Canceled,
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
    ProposalAlreadyCanceled = 8,
    ProposalAlreadyExecuted = 9,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub title: String,
    pub votes_yes: u64,
    pub votes_no: u64,
    pub votes_abstain: u64,
    pub status: ProposalStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Proposal(u32),
    Admin,
    CouncilSigners,
    Threshold,
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
        let proposal = Proposal {
            title: title.clone(),
            votes_yes: 0,
            votes_no: 0,
            votes_abstain: 0,
            status: ProposalStatus::Queued,
        };
        env.storage().persistent().set(&DataKey::Proposal(prop_id), &proposal);
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("proposed")),
            (creator, prop_id, title),
        );
        prop_id
    }

    pub fn vote(env: Env, caller: Address, prop_id: u32, support: bool, weight: u64) -> Result<(), GovernanceError> {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(prop_id))
            .ok_or(GovernanceError::InvalidPhase)?;

        // Reject any voting on canceled or already-executed proposals.
        match proposal.status {
            ProposalStatus::Canceled => return Err(GovernanceError::ProposalAlreadyCanceled),
            ProposalStatus::Executed => return Err(GovernanceError::ProposalAlreadyExecuted),
            ProposalStatus::Queued => {}
        }

        if support {
            proposal.votes_yes = proposal.votes_yes.saturating_add(weight);
        } else {
            proposal.votes_no = proposal.votes_no.saturating_add(weight);
        }
        env.storage().persistent().set(&DataKey::Proposal(prop_id), &proposal);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("voted")),
            (caller, prop_id, support, weight),
        );
        Ok(())
    }

    /// Execute proposal with multi-sig threshold authorization checks.
    /// Collects signers and verifies valid weight/quorum threshold satisfies requirements.
    pub fn execute_proposal(env: Env, prop_id: u32, signers: Vec<Address>) -> Result<(), GovernanceError> {
        // Atomically read the freshest proposal state from persistent storage and
        // reject anything that is not still Queued. This prevents a canceled
        // proposal from being executed even if cancellation raced with execution.
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(prop_id))
            .ok_or(GovernanceError::InvalidPhase)?;

        match proposal.status {
            ProposalStatus::Canceled => return Err(GovernanceError::ProposalAlreadyCanceled),
            ProposalStatus::Executed => return Err(GovernanceError::ProposalAlreadyExecuted),
            ProposalStatus::Queued => {}
        }

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

        // Mark as executed atomically before emitting the event so any
        // subsequent execution attempt is rejected.
        proposal.status = ProposalStatus::Executed;
        env.storage().persistent().set(&DataKey::Proposal(prop_id), &proposal);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("executed")),
            (prop_id,),
        );
        Ok(())
    }

    pub fn execute(env: Env, prop_id: u32) -> Result<(), GovernanceError> {
        Self::execute_proposal(env, prop_id, Vec::new(&env))
    }

    pub fn cancel(env: Env, admin: Address, prop_id: u32) -> Result<(), GovernanceError> {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        if admin != stored_admin {
            return Err(GovernanceError::InvalidPhase);
        }

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(prop_id))
            .ok_or(GovernanceError::InvalidPhase)?;

        // Already canceled: idempotent no-op success.
        if proposal.status == ProposalStatus::Canceled {
            return Ok(());
        }
        // Cannot cancel an already-executed proposal.
        if proposal.status == ProposalStatus::Executed {
            return Err(GovernanceError::ProposalAlreadyExecuted);
        }

        // Immediately persist the Canceled status so any concurrent execution
        // attempt observes the fresh state and is rejected.
        proposal.status = ProposalStatus::Canceled;
        env.storage().persistent().set(&DataKey::Proposal(prop_id), &proposal);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("cancelled")),
            (admin, prop_id),
        );
        Ok(())
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
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
pub mod tests;
