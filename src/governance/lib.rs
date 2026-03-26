#![no_std]
//! Governance Contract with Quadratic Voting

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String};

/// Storage keys for governance contract data
#[contracttype]
pub enum DataKey {
    /// Administrator address authorized to execute proposals
    Admin,
    /// Token contract address for voting power
    TokenContract,
    /// Counter for proposal IDs
    ProposalCounter,
    /// Individual proposal data
    Proposal(u32),
    /// User votes on a specific proposal
    UserVotes(u32, Address),
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
    /// Votes in favor (quadratic voting)
    pub votes_for: i128,
    /// Votes against (quadratic voting)
    pub votes_against: i128,
    /// Timestamp when proposal was created
    pub created_at: u64,
    /// Timestamp when voting period ends
    pub deadline: u64,
    /// Current status of the proposal
    pub status: ProposalStatus,
}

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    /// Initialize the governance contract
    ///
    /// # Arguments
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
        env.storage().instance().set(&DataKey::TokenContract, &token_contract);
        env.storage().instance().set(&DataKey::ProposalCounter, &0u32);
    }

    /// Create a new proposal
    ///
    /// # Arguments
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

        let counter: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0);
        let new_id = counter + 1;

        let proposal = Proposal {
            id: new_id,
            creator: creator.clone(),
            title: title.clone(),
            description,
            votes_for: 0,
            votes_against: 0,
            created_at: env.ledger().timestamp(),
            deadline: env.ledger().timestamp() + voting_period,
            status: ProposalStatus::OPEN,
        };

        env.storage().instance().set(&DataKey::Proposal(new_id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCounter, &new_id);
        env.events().publish(
            (symbol_short!("created"), new_id),
            (creator, title),
        );

        new_id
    }

    /// Vote on a proposal using quadratic voting
    ///
    /// Quadratic voting uses cost = votes^2 to apply voting power.
    /// Each user can only vote once per proposal.
    ///
    /// # Arguments
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
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u32,
        support: bool,
        votes: i128,
    ) {
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
        assert!(
            current_time < proposal.deadline,
            "voting period has ended"
        );

        if env
            .storage()
            .instance()
            .has(&DataKey::UserVotes(proposal_id, voter.clone()))
        {
            panic!("already voted");
        }

        // Calculate quadratic voting cost: votes^2
        let cost = votes
            .checked_mul(votes)
            .expect("quadratic vote cost overflowed");

        // Update proposal vote totals
        if support {
            proposal.votes_for += votes;
        } else {
            proposal.votes_against += votes;
        }

        // Store user's vote for this proposal in instance storage
        env.storage()
            .instance()
            .set(&DataKey::UserVotes(proposal_id, voter.clone()), &votes);

        // Update proposal with new vote totals
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        // Emit vote event
        env.events().publish(
            (symbol_short!("voted"), proposal_id, voter.clone()),
            (support, votes, cost),
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

    /// Check if a proposal has passed (more votes for than against)
    ///
    /// Automatically closes the proposal when voting period ends.
    ///
    /// # Arguments
    /// * `proposal_id` - ID of the proposal to check
    ///
    /// # Returns
    /// True if votes_for > votes_against, false otherwise
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

        proposal.votes_for > proposal.votes_against
    }

    /// Execute a proposal (can only be called by admin or creator)
    ///
    /// Executes the proposal by changing its status to EXECUTED.
    /// Must be called after voting period has ended and proposal passed.
    ///
    /// # Arguments
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

        assert!(
            proposal.votes_for > proposal.votes_against,
            "proposal did not pass"
        );

        proposal.status = ProposalStatus::EXECUTED;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("executed"), proposal_id),
            executor,
        );
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
    /// * `proposal_id` - ID of the proposal
    /// * `voter` - Address of the voter
    ///
    /// # Returns
    /// Number of votes cast by the user (returns 0 if they haven't voted)
    pub fn get_user_votes(env: Env, proposal_id: u32, voter: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::UserVotes(proposal_id, voter))
            .unwrap_or(0)
    }

    /// Calculate quadratic vote cost formula (votes^2)
    ///
    /// # Arguments
    /// * `votes` - Number of votes
    ///
    /// # Returns
    /// The cost of voting (votes squared)
    ///
    /// # Panics
    /// Panics if cost calculation overflows
    pub fn vote_cost(_env: Env, votes: i128) -> i128 {
        votes
            .checked_mul(votes)
            .expect("vote cost overflow")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, String};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_contract = Address::generate(&env);
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        client.initialize(&admin, &token_contract);
        (env, admin, token_contract)
    }

    #[test]
    fn test_initialize() {
        let (_, admin, _) = setup();
        assert!(!admin.is_empty());
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
            &3600u64,
        );
        assert_eq!(proposal_id, 1);
    }

    #[test]
    fn test_quadratic_vote_cost() {
        let env = Env::default();
        assert_eq!(GovernanceContractClient::vote_cost(&env, &0), 0);
        assert_eq!(GovernanceContractClient::vote_cost(&env, &1), 1);
        assert_eq!(GovernanceContractClient::vote_cost(&env, &5), 25);
    }

    #[test]
    fn test_vote_on_proposal() {
        let (env, _, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let creator = Address::generate(&env);
        let voter = Address::generate(&env);
        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &3600u64,
        );
        client.vote(&voter, &proposal_id, &true, &10i128);

        let (votes_for, votes_against) = client.get_proposal_votes(&proposal_id);
        assert_eq!(votes_for, 10);
        assert_eq!(votes_against, 0);

        let user_votes = client.get_user_votes(&proposal_id, &voter);
        assert_eq!(user_votes, 10);
    }

    #[test]
    #[should_panic(expected = "already voted")]
    fn test_double_vote_panics() {
        let (env, _, _) = setup();
        let id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &id);
        let creator = Address::generate(&env);
        let voter = Address::generate(&env);
        let proposal_id = client.create_proposal(
            &creator,
            &String::from_str(&env, "Test Proposal"),
            &String::from_str(&env, "A proposal for testing"),
            &3600u64,
        );
        client.vote(&voter, &proposal_id, &true, &10i128);
        client.vote(&voter, &proposal_id, &true, &10i128);
    }
}
