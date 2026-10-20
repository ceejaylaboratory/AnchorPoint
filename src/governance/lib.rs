#![no_std]
//! Governance Contract with Enhanced Quadratic Voting
//!
//! This contract implements a sophisticated quadratic voting mechanism where:
//! - The cost of casting N votes is N² (quadratic cost)
//! - Users have voting credits that limit their total voting power
//! - Proposals require quorum to pass
//! - Mathematical accuracy is ensured through careful integer operations

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address, Env, IntoVal, String,
};

/// Default voting credits allocated to each user
const DEFAULT_VOTING_CREDITS: i128 = 10_000;

/// Default quorum percentage (20% of total possible votes)
const DEFAULT_QUORUM_PERCENTAGE: i128 = 20;

/// Minimum voting period (1 day)
const MIN_TIMELOCK: u64 = 86400;

/// Maximum voting period (14 days)
const MAX_TIMELOCK: u64 = 1_209_600;

/// Storage keys for governance contract data
#[contracttype]
pub enum DataKey {
    /// Administrator address authorized to execute proposals
    Admin,
    /// Pending new admin address awaiting acceptance (2-step transfer)
    PendingAdmin,
    /// Token contract address for voting power
    TokenContract,
    /// Counter for proposal IDs
    ProposalCounter,
    /// Individual proposal data
    Proposal(u32),
    /// User votes on a specific proposal (stores vote count and direction)
    UserVotes(u32, Address),
    /// User's remaining voting credits
    VotingCredits(Address),
    /// Total voting credits issued (for quorum calculation)
    TotalCreditsIssued,
    /// Quorum percentage required (stored as basis points, e.g., 2000 = 20%)
    QuorumPercentage,
    /// Total quadratic cost spent on a proposal (for analytics)
    ProposalQuadraticCost(u32),
    /// User's quadratic cost spent on a proposal
    UserQuadraticCost(u32, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidTimelockDuration = 1,
}

/// Proposal lifecycle states
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum ProposalStatus {
    /// Proposal is open for voting
    OPEN,
    /// Voting period has ended
    CLOSED,
    /// Proposal has been executed
    EXECUTED,
    /// Proposal was cancelled by its creator before voting closed
    CANCELLED,
}

/// Proposal structure with all governance data
#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    /// Unique proposal identifier
    pub id: u32,
    /// Address of proposal creator
    pub creator: Address,
    /// Proposal title
    pub title: String,
    /// Proposal description
    pub description: String,
    /// Votes in favor (raw vote count, not quadratic)
    pub votes_for: i128,
    /// Votes against (raw vote count, not quadratic)
    pub votes_against: i128,
    /// Total quadratic cost spent on this proposal
    pub total_quadratic_cost: i128,
    /// Number of unique voters
    pub voter_count: u32,
    /// Timestamp when proposal was created
    pub created_at: u64,
    /// Timestamp when voting period ends
    pub deadline: u64,
    /// Current status of the proposal
    pub status: ProposalStatus,
    /// Required quorum (absolute number of votes)
    pub quorum: i128,
    /// Ledger sequence when the proposal was created for token snapshotting
    pub created_at_ledger: u32,
}

/// Vote record for a user on a proposal
#[contracttype]
#[derive(Clone, Copy)]
pub struct VoteRecord {
    /// Number of votes cast
    pub votes: i128,
    /// Quadratic cost paid
    pub quadratic_cost: i128,
    /// Whether vote is for (true) or against (false)
    pub support: bool,
}

#[contract]
pub struct GovernanceContract;

#[allow(deprecated)]
#[contractimpl]
impl GovernanceContract {
    /// Initialize the governance contract
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `admin` - The admin address with execution authority
    /// * `token_contract` - The token contract address for voting power verification
    ///
    /// # Panics
    /// Panics if the contract has already been initialized
    pub fn initialize(env: Env, admin: Address, token_contract: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TokenContract, &token_contract);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCounter, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::TotalCreditsIssued, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::QuorumPercentage, &DEFAULT_QUORUM_PERCENTAGE);
        env.events()
            .publish((symbol_short!("gov_init"),), (admin, token_contract));
    }

    /// Step 1 of 2-step admin transfer: current admin proposes a new admin.
    ///
    /// The new admin is stored as a pending candidate. No ownership change occurs
    /// until `claim_admin_role` is called by the pending admin.
    ///
    /// # Arguments
    /// * `env`       – The environment
    /// * `new_admin` – Address being nominated as the next admin
    ///
    /// # Panics
    /// Panics if the caller is not the current admin.
    pub fn propose_new_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("prop_adm")),
            (admin, new_admin),
        );
    }

    /// Step 2 of 2-step admin transfer: pending admin accepts and claims the role.
    ///
    /// The pending admin must call this function and provide their own authorization.
    /// Once accepted, the new admin is stored and the pending slot is cleared.
    ///
    /// # Panics
    /// Panics if there is no pending admin proposal, or if the caller is not the
    /// pending admin.
    pub fn claim_admin_role(env: Env, new_admin: Address) {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .expect("no pending admin");

        assert!(new_admin == pending, "caller is not the pending admin");
        new_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Admin, &new_admin);
        env.storage()
            .instance()
            .remove(&DataKey::PendingAdmin);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("new_adm")),
            new_admin,
        );
    }

    /// Allocate voting credits to a user
    ///
    /// Voting credits determine how much quadratic voting power a user has.
    /// The cost of casting N votes is N² credits.
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Address calling the function (must be admin)
    /// * `user` - Address to allocate credits to
    /// * `credits` - Number of credits to allocate
    ///
    /// # Panics
    /// Panics if caller is not admin
    pub fn allocate_credits(env: Env, caller: Address, user: Address, credits: i128) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not found");

        assert!(caller == admin, "only admin can allocate credits");
        assert!(credits >= 0, "credits must be non-negative");

        let current_credits: i128 = env
            .storage()
            .instance()
            .get(&DataKey::VotingCredits(user.clone()))
            .unwrap_or(0);

        let total_issued: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCreditsIssued)
            .unwrap_or(0);

        let new_credits = current_credits
            .checked_add(credits)
            .expect("credits overflow");
        env.storage()
            .instance()
            .set(&DataKey::VotingCredits(user.clone()), &new_credits);
        env.storage().instance().set(
            &DataKey::TotalCreditsIssued,
            &total_issued.checked_add(credits).expect("credits overflow"),
        );

        // Topic: event name only; user + amounts in data to avoid indexing large Address.
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("credits")),
            (user, caller, credits, new_credits),
        );
    }

    /// Get user's remaining voting credits
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `user` - Address to check
    ///
    /// # Returns
    /// The user's remaining voting credits
    pub fn get_credits(env: Env, user: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::VotingCredits(user))
            .unwrap_or(DEFAULT_VOTING_CREDITS)
    }

    /// Set the quorum percentage
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Address calling (must be admin)
    /// * `percentage` - Quorum percentage (0-100)
    ///
    /// # Panics
    /// Panics if caller is not admin or percentage is invalid
    pub fn set_quorum_percentage(env: Env, caller: Address, percentage: i128) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not found");

        assert!(caller == admin, "only admin can set quorum");
        assert!((0..=100).contains(&percentage), "invalid quorum percentage");

        env.storage()
            .instance()
            .set(&DataKey::QuorumPercentage, &percentage);

        // Topic: event name only; caller + percentage in data.
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("quorum")),
            (caller, percentage),
        );
    }

    /// Create a new proposal
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `creator` - Address creating the proposal
    /// * `title` - Proposal title
    /// * `description` - Proposal description
    /// * `voting_period` - Duration of voting period in seconds
    ///
    /// # Returns
    /// The ID of the newly created proposal
    ///
    /// # Panics
    /// Panics if voting_period is not positive
    pub fn create_proposal(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        voting_period: u64,
    ) -> u32 {
        creator.require_auth();
        assert!(voting_period > 0, "voting period must be positive");

        if voting_period < MIN_TIMELOCK || voting_period > MAX_TIMELOCK {
            panic_with_error!(&env, Error::InvalidTimelockDuration);
        }

        let counter: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0);
        let new_id = counter.checked_add(1).expect("proposal counter overflow");

        // Calculate quorum based on total credits issued
        let total_credits: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCreditsIssued)
            .unwrap_or(0);
        let quorum_percentage: i128 = env
            .storage()
            .instance()
            .get(&DataKey::QuorumPercentage)
            .unwrap_or(DEFAULT_QUORUM_PERCENTAGE);

        // Quorum is percentage of total credits that must participate
        // Using integer math: quorum = (total_credits * quorum_percentage) / 100
        let quorum = total_credits
            .checked_mul(quorum_percentage)
            .expect("quorum overflow")
            / 100;

        let proposal = Proposal {
            id: new_id,
            creator: creator.clone(),
            title: title.clone(),
            description,
            votes_for: 0,
            votes_against: 0,
            total_quadratic_cost: 0,
            voter_count: 0,
            created_at: env.ledger().timestamp(),
            deadline: env
                .ledger()
                .timestamp()
                .checked_add(voting_period)
                .expect("deadline overflow"),
            status: ProposalStatus::OPEN,
            quorum,
            created_at_ledger: env.ledger().sequence(),
        };

        env.storage()
            .instance()
            .set(&DataKey::Proposal(new_id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCounter, &new_id);
        env.storage()
            .instance()
            .set(&DataKey::ProposalQuadraticCost(new_id), &0i128);

        // Topic: only the scalar proposal id; creator + title in data.
        env.events()
            .publish((symbol_short!("created"), new_id), (creator, title));

        new_id
    }

    /// Cancel a pending proposal. Only its creator may cancel it before voting ends.
    pub fn cancel_proposal(env: Env, creator: Address, proposal_id: u32) {
        creator.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");
        assert!(proposal.creator == creator, "only proposal creator can cancel");
        assert!(proposal.status == ProposalStatus::OPEN, "proposal is not pending");
        assert!(env.ledger().timestamp() < proposal.deadline, "voting period has ended");

        proposal.status = ProposalStatus::CANCELLED;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        env.events().publish(
            (soroban_sdk::Symbol::new(&env, "ProposalCancelled"), proposal_id),
            creator,
        );
    }

    /// Vote on a proposal using quadratic voting
    ///
    /// Quadratic voting uses cost = votes^2 to apply voting power.
    /// Users must have sufficient voting credits to pay the quadratic cost.
    /// Each user can only vote once per proposal.
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `voter` - Address of the voter
    /// * `proposal_id` - ID of the proposal to vote on
    /// * `support` - True to vote for, false to vote against
    /// * `votes` - Number of votes to cast (cost will be votes^2)
    ///
    /// # Panics
    /// Panics if:
    /// - votes is not positive
    /// - proposal is not found
    /// - proposal is not in OPEN status
    /// - voting period has expired
    /// - user has already voted on this proposal
    /// - user has insufficient voting credits
    pub fn vote(env: Env, voter: Address, proposal_id: u32, support: bool, votes: i128) {
        voter.require_auth();
        assert!(votes > 0, "votes must be positive");

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        let current_time = env.ledger().timestamp();
        assert!(
            proposal.status == ProposalStatus::OPEN,
            "proposal is not open"
        );
        assert!(current_time < proposal.deadline, "voting period has ended");

        // Check if user has already voted
        if env
            .storage()
            .instance()
            .has(&DataKey::UserVotes(proposal_id, voter.clone()))
        {
            panic!("already voted");
        }

        // Calculate quadratic voting cost: votes^2
        let quadratic_cost = votes
            .checked_mul(votes)
            .expect("quadratic vote cost overflowed");

        // Check user has sufficient credits
        let user_credits: i128 = env
            .storage()
            .instance()
            .get(&DataKey::VotingCredits(voter.clone()))
            .unwrap_or(DEFAULT_VOTING_CREDITS);

        assert!(
            user_credits >= quadratic_cost,
            "insufficient voting credits"
        );

        let token_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .unwrap();
        let past_token_balance: i128 = env.invoke_contract(
            &token_contract,
            &soroban_sdk::Symbol::new(&env, "get_past_balance"),
            soroban_sdk::vec![
                &env,
                voter.to_val(),
                1u64.into_val(&env),
                proposal.created_at_ledger.into()
            ],
        );

        assert!(
            past_token_balance >= quadratic_cost,
            "insufficient snapshot token balance"
        );

        // Deduct credits from user
        env.storage().instance().set(
            &DataKey::VotingCredits(voter.clone()),
            &(user_credits - quadratic_cost),
        );

        // Update proposal vote totals
        if support {
            proposal.votes_for = proposal
                .votes_for
                .checked_add(votes)
                .expect("votes overflow");
        } else {
            proposal.votes_against = proposal
                .votes_against
                .checked_add(votes)
                .expect("votes overflow");
        }

        // Update quadratic cost tracking
        proposal.total_quadratic_cost = proposal
            .total_quadratic_cost
            .checked_add(quadratic_cost)
            .expect("cost overflow");
        proposal.voter_count = proposal
            .voter_count
            .checked_add(1)
            .expect("voter count overflow");

        // Store vote record
        let vote_record = VoteRecord {
            votes,
            quadratic_cost,
            support,
        };
        env.storage().instance().set(
            &DataKey::UserVotes(proposal_id, voter.clone()),
            &vote_record,
        );

        // Store individual quadratic cost
        env.storage().instance().set(
            &DataKey::UserQuadraticCost(proposal_id, voter.clone()),
            &quadratic_cost,
        );

        // Update proposal with new vote totals
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        // Emit vote event — topic uses only small scalar (proposal_id: u32); voter + details in data.
        env.events().publish(
            (symbol_short!("voted"), proposal_id),
            (voter, support, votes, quadratic_cost),
        );
    }

    /// Get proposal details
    ///
    /// # Arguments
    /// * `proposal_id` - ID of the proposal to retrieve
    ///
    /// # Returns
    /// The proposal structure
    ///
    /// # Panics
    /// Panics if proposal is not found
    pub fn get_proposal(env: Env, proposal_id: u32) -> Proposal {
        env.storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found")
    }

    /// Check if a proposal has passed (more votes for than against, quorum met)
    ///
    /// Automatically closes the proposal when voting period ends.
    /// A proposal passes if:
    /// 1. Quorum is met (total votes >= quorum threshold)
    /// 2. More votes for than against
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `proposal_id` - ID of the proposal to check
    ///
    /// # Returns
    /// True if proposal passed, false otherwise
    ///
    /// # Panics
    /// Panics if:
    /// - proposal is not found
    /// - voting period has not ended
    /// - proposal has already been executed
    pub fn has_passed(env: Env, proposal_id: u32) -> bool {
        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        let current_time = env.ledger().timestamp();

        // Close proposal if voting period has ended
        if proposal.status == ProposalStatus::OPEN {
            assert!(
                current_time >= proposal.deadline,
                "voting period has not ended"
            );
            proposal.status = ProposalStatus::CLOSED;
            env.storage()
                .instance()
                .set(&DataKey::Proposal(proposal_id), &proposal);
        }

        // Cannot check status of executed proposals
        assert!(
            proposal.status != ProposalStatus::EXECUTED,
            "proposal already executed"
        );

        // Check quorum is met
        let total_votes = proposal.votes_for + proposal.votes_against;
        if proposal.quorum > 0 && total_votes < proposal.quorum {
            return false;
        }

        proposal.votes_for > proposal.votes_against
    }

    /// Check if quorum was reached for a proposal
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `proposal_id` - ID of the proposal
    ///
    /// # Returns
    /// True if quorum was reached
    pub fn quorum_reached(env: Env, proposal_id: u32) -> bool {
        let proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        let total_votes = proposal.votes_for + proposal.votes_against;
        total_votes >= proposal.quorum
    }

    /// Execute a proposal (can only be called by admin or creator)
    ///
    /// Executes the proposal by changing its status to EXECUTED.
    /// Must be called after voting period has ended and proposal passed.
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `executor` - Address executing the proposal (must be admin or creator)
    /// * `proposal_id` - ID of the proposal to execute
    ///
    /// # Panics
    /// Panics if:
    /// - executor is neither admin nor proposal creator
    /// - proposal is not found
    /// - voting period has not ended (if proposal is still OPEN)
    /// - proposal status is not CLOSED before execution
    /// - proposal did not pass the vote
    /// - quorum was not reached
    pub fn execute_proposal(env: Env, executor: Address, proposal_id: u32) {
        executor.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not found");

        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        assert!(
            executor == admin || executor == proposal.creator,
            "only admin or creator can execute"
        );

        let current_time = env.ledger().timestamp();

        // Close proposal if voting period has ended
        if proposal.status == ProposalStatus::OPEN {
            assert!(
                current_time >= proposal.deadline,
                "voting period has not ended"
            );
            proposal.status = ProposalStatus::CLOSED;
        }

        assert!(
            proposal.status == ProposalStatus::CLOSED,
            "proposal must be closed before execution"
        );

        // Check quorum
        let total_votes = proposal.votes_for + proposal.votes_against;
        assert!(
            proposal.quorum == 0 || total_votes >= proposal.quorum,
            "quorum not reached"
        );

        assert!(
            proposal.votes_for > proposal.votes_against,
            "proposal did not pass"
        );

        proposal.status = ProposalStatus::EXECUTED;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        // Topic: only scalar proposal_id; executor Address in data.
        env.events()
            .publish((symbol_short!("executed"), proposal_id), executor);
    }

    /// Get total votes for a proposal
    ///
    /// # Arguments
    /// * `proposal_id` - ID of the proposal
    ///
    /// # Returns
    /// Tuple of (votes_for, votes_against)
    ///
    /// # Panics
    /// Panics if proposal is not found
    pub fn get_proposal_votes(env: Env, proposal_id: u32) -> (i128, i128) {
        let proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        (proposal.votes_for, proposal.votes_against)
    }

    /// Check if user has voted on a proposal
    ///
    /// # Arguments
    /// * `proposal_id` - ID of the proposal
    /// * `voter` - Address of the voter
    ///
    /// # Returns
    /// True if user has voted on this proposal, false otherwise
    pub fn has_voted(env: Env, proposal_id: u32, voter: Address) -> bool {
        env.storage()
            .instance()
            .has(&DataKey::UserVotes(proposal_id, voter))
    }

    /// Get how many votes user cast for a proposal
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `proposal_id` - ID of the proposal
    /// * `voter` - Address of the voter
    ///
    /// # Returns
    /// Number of votes cast by the user (returns 0 if they haven't voted)
    pub fn get_user_votes(env: Env, proposal_id: u32, voter: Address) -> i128 {
        let vote_record: Option<VoteRecord> = env
            .storage()
            .instance()
            .get(&DataKey::UserVotes(proposal_id, voter));

        vote_record.map(|r| r.votes).unwrap_or(0)
    }

    /// Get the vote record for a user on a proposal
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `proposal_id` - ID of the proposal
    /// * `voter` - Address of the voter
    ///
    /// # Returns
    /// The vote record if voted, None otherwise
    pub fn get_vote_record(env: Env, proposal_id: u32, voter: Address) -> Option<VoteRecord> {
        env.storage()
            .instance()
            .get(&DataKey::UserVotes(proposal_id, voter))
    }

    /// Get the quadratic cost paid by a user for a proposal
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `proposal_id` - ID of the proposal
    /// * `voter` - Address of the voter
    ///
    /// # Returns
    /// Quadratic cost paid (returns 0 if not voted)
    pub fn get_user_quadratic_cost(env: Env, proposal_id: u32, voter: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::UserQuadraticCost(proposal_id, voter))
            .unwrap_or(0)
    }

    /// Calculate quadratic vote cost formula (votes^2)
    ///
    /// This is a pure function for calculating the cost of votes.
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `votes` - Number of votes
    ///
    /// # Returns
    /// The cost of voting (votes squared)
    ///
    /// # Panics
    /// Panics if cost calculation overflows
    pub fn vote_cost(_env: Env, votes: i128) -> i128 {
        votes.checked_mul(votes).expect("vote cost overflow")
    }

    /// Calculate the maximum votes a user can cast given their credits
    ///
    /// Since cost = votes^2, max votes = floor(sqrt(credits))
    /// Uses integer square root approximation.
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `user` - Address of the user
    ///
    /// # Returns
    /// Maximum votes the user can cast
    pub fn max_votes(env: Env, user: Address) -> i128 {
        let credits = Self::get_credits(env, user);

        // Integer square root approximation
        // Using Newton's method for sqrt
        if credits <= 1 {
            return credits;
        }

        let mut x = credits;
        let mut y = (x + 1) / 2;

        while y < x {
            x = y;
            y = (x + credits / x) / 2;
        }

        x
    }

    /// Get total quadratic cost spent on a proposal
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `proposal_id` - ID of the proposal
    ///
    /// # Returns
    /// Total quadratic cost spent
    pub fn get_proposal_quadratic_cost(env: Env, proposal_id: u32) -> i128 {
        let proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        proposal.total_quadratic_cost
    }

    /// Get the number of unique voters for a proposal
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `proposal_id` - ID of the proposal
    ///
    /// # Returns
    /// Number of unique voters
    pub fn get_voter_count(env: Env, proposal_id: u32) -> u32 {
        let proposal: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");

        proposal.voter_count
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, String};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_contract = env.register(MockToken, ());
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        client.initialize(&admin, &token_contract);
        (env, admin, token_contract)
    }

    #[test]
    fn test_initialize() {
        let (_, _admin, _) = setup();
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_panics() {
        let (env, admin, token_contract) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        client.initialize(&admin, &token_contract);
        client.initialize(&admin, &token_contract);
    }

    #[test]
    fn test_create_proposal() {
        let (env, _, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let creator = Address::generate(&env);
        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &86400u64,
        );
        assert_eq!(proposal_id, 1);
    }

    #[test]
    fn test_creator_can_cancel_pending_proposal() {
        let (env, _, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let creator = Address::generate(&env);
        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &86400u64,
        );

        client.cancel_proposal(&creator, &proposal_id);

        assert_eq!(client.get_proposal(&proposal_id).status, ProposalStatus::CANCELLED);
    }

    #[test]
    #[should_panic(expected = "only proposal creator can cancel")]
    fn test_non_creator_cannot_cancel_proposal() {
        let (env, _, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let creator = Address::generate(&env);
        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &86400u64,
        );

        client.cancel_proposal(&Address::generate(&env), &proposal_id);
    }

    #[test]
    #[should_panic(expected = "proposal is not open")]
    fn test_cancelled_proposal_cannot_be_voted_on() {
        let (env, _, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let creator = Address::generate(&env);
        let voter = Address::generate(&env);
        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &86400u64,
        );

        client.cancel_proposal(&creator, &proposal_id);
        client.vote(&voter, &proposal_id, &true, &1i128);
    }

    #[test]
    #[should_panic(expected = "proposal must be closed before execution")]
    fn test_cancelled_proposal_cannot_be_executed() {
        let (env, _, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let creator = Address::generate(&env);
        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &86400u64,
        );

        client.cancel_proposal(&creator, &proposal_id);
        client.execute_proposal(&creator, &proposal_id);
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #1)")]
    fn test_create_proposal_timelock_too_short() {
        let (env, _, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let creator = Address::generate(&env);
        client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &86399u64, // MIN_TIMELOCK - 1
        );
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #1)")]
    fn test_create_proposal_timelock_too_long() {
        let (env, _, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let creator = Address::generate(&env);
        client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &1209601u64, // MAX_TIMELOCK + 1
        );
    }

    #[test]
    fn test_quadratic_vote_cost() {
        let env = Env::default();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        assert_eq!(client.vote_cost(&0), 0);
        assert_eq!(client.vote_cost(&1), 1);
        assert_eq!(client.vote_cost(&5), 25);
    }

    #[test]
    fn test_vote_on_proposal() {
        let (env, admin, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let token_contract = env.register(MockToken, ());
        client.initialize(&admin, &token_contract);

        let creator = Address::generate(&env);
        let voter = Address::generate(&env);

        // Allocate credits to voter
        client.allocate_credits(&admin, &voter, &1000);

        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &86400u64,
        );
        client.vote(&voter, &proposal_id, &true, &10i128);

        let (votes_for, votes_against) = client.get_proposal_votes(&proposal_id);
        assert_eq!(votes_for, 10);
        assert_eq!(votes_against, 0);

        let user_votes = client.get_user_votes(&proposal_id, &voter);
        assert_eq!(user_votes, 10);

        // Check quadratic cost was deducted
        let quadratic_cost = client.get_user_quadratic_cost(&proposal_id, &voter);
        assert_eq!(quadratic_cost, 100); // 10^2 = 100

        // Check remaining credits
        let remaining = client.get_credits(&voter);
        assert_eq!(remaining, 900); // 1000 - 100 = 900
    }

    #[test]
    #[should_panic(expected = "already voted")]
    fn test_double_vote_panics() {
        let (env, admin, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let token_contract = env.register(MockToken, ());
        client.initialize(&admin, &token_contract);

        let creator = Address::generate(&env);
        let voter = Address::generate(&env);

        client.allocate_credits(&admin, &voter, &1000);

        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &86400u64,
        );
        client.vote(&voter, &proposal_id, &true, &10i128);
        client.vote(&voter, &proposal_id, &true, &10i128);
    }

    #[test]
    #[should_panic(expected = "insufficient voting credits")]
    fn test_insufficient_credits_panics() {
        let (env, admin, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let token_contract = env.register(MockToken, ());
        client.initialize(&admin, &token_contract);

        let creator = Address::generate(&env);
        let voter = Address::generate(&env);

        // Allocate only 100 credits (can cast max 10 votes)
        client.allocate_credits(&admin, &voter, &100);

        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &86400u64,
        );

        // Try to cast 11 votes (cost = 121, but only have 100 credits)
        client.vote(&voter, &proposal_id, &true, &11i128);
    }

    #[test]
    fn test_propose_and_claim_admin() {
        let (env, admin, _token) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let token_contract = env.register(MockToken, ());
        client.initialize(&admin, &token_contract);

        let new_admin = Address::generate(&env);

        // Step 1: current admin proposes a new admin
        client.propose_new_admin(&new_admin);

        // Step 2: new admin claims the role
        client.claim_admin_role(&new_admin);

        // New admin should now be able to allocate credits (admin-only action)
        let user = Address::generate(&env);
        client.allocate_credits(&new_admin, &user, &100);
        assert_eq!(client.get_credits(&user), 100);
    }

    #[test]
    #[should_panic(expected = "no pending admin")]
    fn test_claim_admin_without_proposal_panics() {
        let (env, admin, _token) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let token_contract = env.register(MockToken, ());
        client.initialize(&admin, &token_contract);

        let new_admin = Address::generate(&env);
        // No proposal made, claiming should panic
        client.claim_admin_role(&new_admin);
    }

    #[test]
    #[should_panic(expected = "caller is not the pending admin")]
    fn test_claim_admin_wrong_address_panics() {
        let (env, admin, _token) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let token_contract = env.register(MockToken, ());
        client.initialize(&admin, &token_contract);

        let new_admin = Address::generate(&env);
        let impersonator = Address::generate(&env);

        // Propose new_admin but try to claim with a different address
        client.propose_new_admin(&new_admin);
        client.claim_admin_role(&impersonator);
    }

    #[test]
    fn test_old_admin_loses_access_after_transfer() {
        let (env, admin, _token) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let token_contract = env.register(MockToken, ());
        client.initialize(&admin, &token_contract);

        let new_admin = Address::generate(&env);
        client.propose_new_admin(&new_admin);
        client.claim_admin_role(&new_admin);

        // Old admin should no longer be able to allocate credits
        let user = Address::generate(&env);
        // This should panic because admin is no longer the admin
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.allocate_credits(&admin, &user, &100);
        }));
        assert!(result.is_err(), "old admin should no longer have access");
    }

    // ---- #1536 regression: VotingCredits must be decremented after a vote ---

    /// After casting a vote the voter's credits must be reduced by the quadratic
    /// cost (votes²).  If credits are not decremented the voter could cast more
    /// votes than their budget allows across successive calls.
    #[test]
    fn test_voting_credits_decremented_after_vote() {
        let (env, admin, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let token_contract = env.register(MockToken, ());
        client.initialize(&admin, &token_contract);

        let creator = Address::generate(&env);
        let voter = Address::generate(&env);

        // Give the voter a known credit budget.
        client.allocate_credits(&admin, &voter, &1000);
        assert_eq!(client.get_credits(&voter), 1000);

        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Credit Decrement Test"),
            &String::from_str(&env, "Verifies credits are deducted on vote"),
            &86400u64,
        );

        // Cast 10 votes; quadratic cost = 10² = 100.
        client.vote(&voter, &proposal_id, &true, &10i128);

        // Credits must have dropped by exactly the quadratic cost.
        let remaining = client.get_credits(&voter);
        assert_eq!(
            remaining, 900,
            "credits must be decremented by quadratic cost (100); got {}",
            remaining
        );
    }

    /// A user who has already voted on a proposal must not be able to vote a
    /// second time, even if their remaining credits are sufficient.
    #[test]
    fn test_double_vote_blocked_after_credits_decremented() {
        let (env, admin, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let token_contract = env.register(MockToken, ());
        client.initialize(&admin, &token_contract);

        let creator = Address::generate(&env);
        let voter = Address::generate(&env);

        // Generous credit budget — the voter could theoretically cast a second
        // vote if the double-vote check were absent.
        client.allocate_credits(&admin, &voter, &10000);

        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Double Vote Test"),
            &String::from_str(&env, "Verifies a voter cannot vote twice"),
            &86400u64,
        );

        // First vote succeeds.
        client.vote(&voter, &proposal_id, &true, &5i128);

        // Second vote on the *same* proposal must be rejected with "already voted",
        // regardless of remaining credits (10000 - 25 = 9975 remaining).
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.vote(&voter, &proposal_id, &false, &5i128);
        }));
        assert!(
            result.is_err(),
            "second vote on the same proposal must be rejected"
        );

        // Proposal vote totals must reflect only the first vote.
        let (votes_for, votes_against) = client.get_proposal_votes(&proposal_id);
        assert_eq!(votes_for, 5, "only the first vote should be counted");
        assert_eq!(votes_against, 0, "second vote must not have been recorded");
    }
}

/// ============================================================================
/// Quadratic Voting Mathematical Accuracy Tests
/// ============================================================================
#[cfg(test)]
mod quadratic_voting_tests {
    extern crate std;
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, String};

    fn setup_with_credits() -> (Env, GovernanceContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let token_contract = env.register(MockToken, ());
        client.initialize(&admin, &token_contract);
        (env, client, admin)
    }

    #[test]
    fn test_quadratic_cost_formula() {
        let env = Env::default();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);

        // Test quadratic cost formula: cost = votes^2
        assert_eq!(client.vote_cost(&1), 1);
        assert_eq!(client.vote_cost(&2), 4);
        assert_eq!(client.vote_cost(&5), 25);
        assert_eq!(client.vote_cost(&10), 100);
        assert_eq!(client.vote_cost(&100), 10000);
    }

    #[test]
    fn test_max_votes_calculation() {
        let (env, client, admin) = setup_with_credits();
        let user = Address::generate(&env);

        // With 100 credits, max votes = 10 (sqrt(100) = 10)
        client.allocate_credits(&admin, &user, &100);
        assert_eq!(client.max_votes(&user), 10);

        // With 10000 credits, max votes = 100 (sqrt(10000) = 100)
        client.allocate_credits(&admin, &user, &10000);
        assert_eq!(client.max_votes(&user), 100);
    }

    #[test]
    fn test_quadratic_voting_favors_many_voters() {
        // Quadratic voting is designed so that spreading votes across
        // many voters is more efficient than concentrating them.
        //
        // Example: 100 credits can cast:
        // - 1 voter casting 10 votes (cost = 100)
        // - 10 voters casting 1 vote each (cost = 1 each, total = 10)
        //
        // The 10 voters get 10 total votes for 10 credits,
        // while 1 voter gets 10 votes for 100 credits.

        let (env, client, admin) = setup_with_credits();
        let creator = Address::generate(&env);

        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Quadratic Test"),
            &String::from_str(&env, "Testing quadratic voting efficiency"),
            &86400u64,
        );

        // Single voter with 100 credits casting 10 votes
        let single_voter = Address::generate(&env);
        client.allocate_credits(&admin, &single_voter, &100);
        client.vote(&single_voter, &proposal_id, &true, &10);

        // This voter spent all 100 credits
        assert_eq!(client.get_credits(&single_voter), 0);

        // Total votes: 10, total cost: 100
        assert_eq!(client.get_proposal_quadratic_cost(&proposal_id), 100);
    }

    #[test]
    fn test_multiple_voters_efficiency() {
        let (env, client, admin) = setup_with_credits();
        let creator = Address::generate(&env);

        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Quadratic Test"),
            &String::from_str(&env, "Testing multiple voters"),
            &86400u64,
        );

        // 10 voters each with 1 credit, casting 1 vote each
        // Total cost: 10 (1 vote = 1 credit)
        // Total votes: 10

        for _ in 0..10 {
            let voter = Address::generate(&env);
            client.allocate_credits(&admin, &voter, &1);
            client.vote(&voter, &proposal_id, &true, &1);
        }

        let (votes_for, _) = client.get_proposal_votes(&proposal_id);
        assert_eq!(votes_for, 10);

        // Total quadratic cost should be 10 (10 voters * 1 credit each)
        assert_eq!(client.get_proposal_quadratic_cost(&proposal_id), 10);

        // Voter count should be 10
        assert_eq!(client.get_voter_count(&proposal_id), 10);
    }

    #[test]
    fn test_vote_record_storage() {
        let (env, client, admin) = setup_with_credits();
        let creator = Address::generate(&env);
        let voter = Address::generate(&env);

        client.allocate_credits(&admin, &voter, &1000);

        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Vote Record Test"),
            &String::from_str(&env, "Testing vote record storage"),
            &86400u64,
        );

        client.vote(&voter, &proposal_id, &false, &15);

        // Check vote record
        let record = client.get_vote_record(&proposal_id, &voter);
        assert!(record.is_some());

        let record = record.unwrap();
        assert_eq!(record.votes, 15);
        assert_eq!(record.quadratic_cost, 225); // 15^2
        assert!(!record.support); // voted against
    }

    #[test]
    fn test_quorum_calculation() {
        let (env, client, admin) = setup_with_credits();
        let creator = Address::generate(&env);

        // Allocate total credits to set up quorum
        // With 1000 total credits and 20% quorum, need 200 votes
        let voters: std::vec::Vec<Address> = (0..5).map(|_| Address::generate(&env)).collect();
        for voter in &voters {
            client.allocate_credits(&admin, voter, &200);
        }

        // Total credits issued = 1000
        // Quorum = 20% of 1000 = 200
        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Quorum Test"),
            &String::from_str(&env, "Testing quorum"),
            &86400u64,
        );

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.quorum, 200);

        // Vote with 10 votes each from 5 voters = 50 total votes
        // This is below quorum of 200
        for voter in &voters {
            client.vote(voter, &proposal_id, &true, &10);
        }

        let (votes_for, _) = client.get_proposal_votes(&proposal_id);
        assert_eq!(votes_for, 50);
        assert!(!client.quorum_reached(&proposal_id));
    }
}

#[cfg(test)]
#[contract]
pub struct MockToken;

#[cfg(test)]
#[contractimpl]
impl MockToken {
    pub fn get_past_balance(_env: Env, _owner: Address, _token_id: u64, _ledger: u32) -> i128 {
        1_000_000i128
    }
}
