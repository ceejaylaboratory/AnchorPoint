#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};

/// Minimum timelock delay in ledgers (~5s per ledger on Stellar, 48 hours = 48 * 3600 / 5 = 34,560 ledgers).
pub const MIN_TIMELOCK_DELAY: u32 = 34_560;

const TTL_THRESHOLD: u32 = 120_960;
const TTL_EXTENSION: u32 = 518_400;

fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTENSION);
}

fn bump_proposal_ttl(env: &Env, prop_id: u32) {
    env.storage().persistent().extend_ttl(
        &DataKey::Proposal(prop_id),
        TTL_THRESHOLD,
        TTL_EXTENSION,
    );
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Phase {
    Draft,
    Active,
    QuorumReached,
    ExecutionPending,
    Queued,
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
    TimelockNotExpired = 8,
    InvalidTimelockDelay = 9,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub title: String,
    pub creator: Address,
    pub votes_yes: u64,
    pub votes_no: u64,
    pub votes_abstain: u64,
    pub voting_start: u32,
    pub voting_end: u32,
    pub status: Phase,
    pub executable_after_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Proposal(u32),
    Admin,
    CouncilSigners,
    Threshold,
    TimelockDelay,
    ProposalCount,
    QuorumThreshold,
    VotingDuration,
    Voted(u32, Address),
}

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        quorum_threshold: u64,
        voting_duration: u64,
        timelock_delay: u32,
    ) -> Result<(), GovernanceError> {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        if timelock_delay < MIN_TIMELOCK_DELAY {
            return Err(GovernanceError::InvalidTimelockDelay);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::QuorumThreshold, &quorum_threshold);
        env.storage()
            .instance()
            .set(&DataKey::VotingDuration, &(voting_duration as u32));
        env.storage()
            .instance()
            .set(&DataKey::TimelockDelay, &timelock_delay);
        bump_instance_ttl(&env);
        env.events().publish((symbol_short!("gov_init"),), admin);
        Ok(())
    }

    /// Configure the vector of governance council address signers and required threshold (M of N).
    pub fn set_council(env: Env, admin: Address, signers: Vec<Address>, threshold: u32) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        assert!(
            threshold > 0 && threshold <= signers.len(),
            "invalid threshold"
        );
        env.storage()
            .instance()
            .set(&DataKey::CouncilSigners, &signers);
        env.storage()
            .instance()
            .set(&DataKey::Threshold, &threshold);
        bump_instance_ttl(&env);
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("council")),
            (admin, signers, threshold),
        );
    }

    /// Get configured council signers.
    pub fn get_council_signers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::CouncilSigners)
            .unwrap_or(Vec::new(&env))
    }

    /// Get required threshold of signatures.
    pub fn get_threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Threshold)
            .unwrap_or(0)
    }

    pub fn transfer_admin(env: Env, admin: Address, new_admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("transfer")),
            (admin, new_admin),
        );
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set")
    }

    pub fn set_timelock_delay(
        env: Env,
        admin: Address,
        timelock_delay: u32,
    ) -> Result<(), GovernanceError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        if timelock_delay < MIN_TIMELOCK_DELAY {
            return Err(GovernanceError::InvalidTimelockDelay);
        }
        env.storage()
            .instance()
            .set(&DataKey::TimelockDelay, &timelock_delay);
        bump_instance_ttl(&env);
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("timelock")),
            (admin, timelock_delay),
        );
        Ok(())
    }

    pub fn get_timelock_delay(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TimelockDelay)
            .unwrap_or(MIN_TIMELOCK_DELAY)
    }

    pub fn create_proposal(env: Env, creator: Address, title: String) -> u32 {
        creator.require_auth();
        let prop_id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCount, &(prop_id + 1));

        let current_ledger = env.ledger().sequence();
        let voting_duration: u32 = env
            .storage()
            .instance()
            .get(&DataKey::VotingDuration)
            .unwrap_or(100);
        let voting_start = current_ledger + 1;
        let voting_end = current_ledger + voting_duration;

        let proposal = Proposal {
            title: title.clone(),
            creator: creator.clone(),
            votes_yes: 0,
            votes_no: 0,
            votes_abstain: 0,
            voting_start,
            voting_end,
            status: Phase::Draft,
            executable_after_ledger: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(prop_id), &proposal);
        bump_instance_ttl(&env);
        bump_proposal_ttl(&env, prop_id);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("proposed")),
            (creator, prop_id, title),
        );
        prop_id
    }

    pub fn vote(
        env: Env,
        caller: Address,
        prop_id: u32,
        support: bool,
        weight: u64,
    ) -> Result<(), GovernanceError> {
        caller.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(prop_id))
            .ok_or(GovernanceError::InvalidPhase)?;

        let current_ledger = env.ledger().sequence();

        if proposal.status == Phase::Cancelled {
            return Err(GovernanceError::InvalidPhase);
        }
        if current_ledger < proposal.voting_start {
            return Err(GovernanceError::InvalidPhase);
        }
        if current_ledger > proposal.voting_end {
            return Err(GovernanceError::VotingClosed);
        }

        let vote_key = DataKey::Voted(prop_id, caller.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(GovernanceError::AlreadyVoted);
        }
        env.storage().persistent().set(&vote_key, &true);

        if support {
            proposal.votes_yes = proposal.votes_yes.checked_add(weight).expect("overflow");
        } else {
            proposal.votes_no = proposal.votes_no.checked_add(weight).expect("overflow");
        }

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(prop_id), &proposal);
        bump_instance_ttl(&env);
        bump_proposal_ttl(&env, prop_id);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("voted")),
            (caller, prop_id, support, weight),
        );
        Ok(())
    }

    pub fn queue_proposal(env: Env, prop_id: u32) -> Result<(), GovernanceError> {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(prop_id))
            .ok_or(GovernanceError::InvalidPhase)?;

        if proposal.status == Phase::Cancelled
            || proposal.status == Phase::Executed
            || proposal.status == Phase::Queued
        {
            return Err(GovernanceError::InvalidPhase);
        }

        let current_ledger = env.ledger().sequence();
        if current_ledger <= proposal.voting_end {
            return Err(GovernanceError::InvalidPhase);
        }

        let quorum_threshold: u64 = env
            .storage()
            .instance()
            .get(&DataKey::QuorumThreshold)
            .unwrap_or(0);
        if proposal.votes_yes < quorum_threshold || proposal.votes_yes <= proposal.votes_no {
            return Err(GovernanceError::QuorumNotReached);
        }

        let timelock_delay: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TimelockDelay)
            .unwrap_or(MIN_TIMELOCK_DELAY);
        let executable_after = current_ledger
            .checked_add(timelock_delay)
            .expect("overflow");

        proposal.status = Phase::Queued;
        proposal.executable_after_ledger = executable_after;

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(prop_id), &proposal);
        bump_instance_ttl(&env);
        bump_proposal_ttl(&env, prop_id);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("queued")),
            (prop_id, executable_after),
        );

        Ok(())
    }

    pub fn queue(env: Env, prop_id: u32) -> Result<(), GovernanceError> {
        Self::queue_proposal(env, prop_id)
    }

    /// Execute proposal with multi-sig threshold authorization checks and timelock enforcement.
    pub fn execute_proposal(
        env: Env,
        prop_id: u32,
        signers: Vec<Address>,
    ) -> Result<(), GovernanceError> {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(prop_id))
            .ok_or(GovernanceError::InvalidPhase)?;

        if proposal.status == Phase::Cancelled || proposal.status == Phase::Executed {
            return Err(GovernanceError::InvalidPhase);
        }

        let quorum_threshold: u64 = env
            .storage()
            .instance()
            .get(&DataKey::QuorumThreshold)
            .unwrap_or(0);
        if proposal.votes_yes < quorum_threshold || proposal.votes_yes <= proposal.votes_no {
            return Err(GovernanceError::QuorumNotReached);
        }

        if proposal.status != Phase::Queued {
            return Err(GovernanceError::InvalidPhase);
        }

        let current_ledger = env.ledger().sequence();
        if current_ledger < proposal.executable_after_ledger {
            return Err(GovernanceError::TimelockNotExpired);
        }

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Threshold)
            .unwrap_or(0);
        let council: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::CouncilSigners)
            .unwrap_or(Vec::new(&env));

        if threshold > 0 {
            if signers.len() < threshold {
                return Err(GovernanceError::InsufficientSignatures);
            }

            let mut valid_weight: u32 = 0;
            let mut verified_signers: Vec<Address> = Vec::new(&env);

            for i in 0..signers.len() {
                let signer = signers.get(i).unwrap();

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

                for k in 0..verified_signers.len() {
                    if verified_signers.get(k).unwrap() == signer {
                        return Err(GovernanceError::DuplicateSigner);
                    }
                }

                signer.require_auth();
                verified_signers.push_back(signer);
                valid_weight += 1;
            }

            if valid_weight < threshold {
                return Err(GovernanceError::InsufficientSignatures);
            }
        }

        proposal.status = Phase::Executed;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(prop_id), &proposal);
        bump_instance_ttl(&env);
        bump_proposal_ttl(&env, prop_id);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("executed")),
            (prop_id,),
        );
        Ok(())
    }

    pub fn execute(env: Env, prop_id: u32) -> Result<(), GovernanceError> {
        Self::execute_proposal(env.clone(), prop_id, Vec::new(&env))
    }

    pub fn cancel(env: Env, caller: Address, prop_id: u32) -> Result<(), GovernanceError> {
        caller.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(prop_id))
            .ok_or(GovernanceError::InvalidPhase)?;

        if proposal.status == Phase::Executed || proposal.status == Phase::Cancelled {
            return Err(GovernanceError::InvalidPhase);
        }

        let stored_admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        let is_admin = stored_admin.as_ref() == Some(&caller);

        let current_ledger = env.ledger().sequence();
        let is_creator_in_draft =
            proposal.creator == caller && current_ledger < proposal.voting_start;

        let council: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::CouncilSigners)
            .unwrap_or(Vec::new(&env));
        let mut is_council = false;
        for i in 0..council.len() {
            if council.get(i).unwrap() == caller {
                is_council = true;
                break;
            }
        }

        let is_authorized = is_admin
            || is_creator_in_draft
            || (is_council
                && (proposal.status == Phase::Queued || proposal.status == Phase::Active));
        if !is_authorized {
            panic!("unauthorized");
        }

        proposal.status = Phase::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(prop_id), &proposal);
        bump_instance_ttl(&env);
        bump_proposal_ttl(&env, prop_id);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("cancelled")),
            (caller, prop_id),
        );
        Ok(())
    }

    pub fn veto(env: Env, caller: Address, prop_id: u32) -> Result<(), GovernanceError> {
        Self::cancel(env, caller, prop_id)
    }

    pub fn get_proposal(env: Env, prop_id: u32) -> Option<Proposal> {
        env.storage().persistent().get(&DataKey::Proposal(prop_id))
    }

    pub fn get_phase(env: Env, prop_id: u32) -> Phase {
        Self::query_phase(&env, prop_id)
    }

    pub fn query_phase(env: &Env, prop_id: u32) -> Phase {
        let prop: Proposal = match env.storage().persistent().get(&DataKey::Proposal(prop_id)) {
            Some(p) => p,
            None => return Phase::Draft,
        };

        if prop.status == Phase::Cancelled {
            return Phase::Cancelled;
        }
        if prop.status == Phase::Executed {
            return Phase::Executed;
        }
        if prop.status == Phase::Queued {
            return Phase::Queued;
        }

        let current_ledger = env.ledger().sequence();
        if current_ledger < prop.voting_start {
            return Phase::Draft;
        }
        if current_ledger <= prop.voting_end {
            return Phase::Active;
        }

        let quorum_threshold: u64 = env
            .storage()
            .instance()
            .get(&DataKey::QuorumThreshold)
            .unwrap_or(0);
        if prop.votes_yes >= quorum_threshold && prop.votes_yes > prop.votes_no {
            Phase::ExecutionPending
        } else {
            Phase::Defeated
        }
    }
}

pub fn get_phase(env: Env, prop_id: u32) -> Phase {
    GovernanceContract::query_phase(&env, prop_id)
}

pub struct ProposalMath;
#[allow(clippy::result_unit_err)]
impl ProposalMath {
    pub fn calculate_total_weight(a: u64, b: u64) -> Result<u64, ()> {
        a.checked_add(b).ok_or(())
    }
    pub fn calculate_quorum(total: u64, bps: u32) -> Result<u64, ()> {
        if bps > 10000 {
            return Err(());
        }
        let total_u128 = total as u128;
        let bps_u128 = bps as u128;
        let result = (total_u128 * bps_u128) / 10000;
        if result > u64::MAX as u128 {
            return Err(());
        }
        Ok(result as u64)
    }
    pub fn calculate_deadline(start: u32, duration: u32) -> Result<u32, ()> {
        start.checked_add(duration).ok_or(())
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
pub mod tests;
