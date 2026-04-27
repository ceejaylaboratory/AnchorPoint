#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env};

// ============================================================================
// Storage Keys & Structures
// ============================================================================

#[contracttype]
pub enum DataKey {
    Admin,
    Grant(u32),
    GrantCounter,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Grant {
    pub beneficiary: Address,
    pub token: Address,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub start_time: u64,
    pub cliff_duration: u64,
    pub vesting_duration: u64,
}

#[contract]
pub struct VestingContract;

#[contractimpl]
impl VestingContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::GrantCounter, &0u32);
    }

    /// Creates a new vesting grant.
    /// The admin must provide the tokens upfront.
    pub fn create_grant(
        env: Env,
        beneficiary: Address,
        token: Address,
        amount: i128,
        start_time: u64,
        cliff_duration: u64,
        vesting_duration: u64,
    ) -> u32 {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        assert!(amount > 0, "amount must be positive");
        assert!(vesting_duration > 0, "duration must be positive");

        // Deposit tokens into the contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&admin, &env.current_contract_address(), &amount);

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::GrantCounter)
            .unwrap_or(0);

        let grant = Grant {
            beneficiary,
            token,
            total_amount: amount,
            claimed_amount: 0,
            start_time,
            cliff_duration,
            vesting_duration,
        };

        env.storage().persistent().set(&DataKey::Grant(id), &grant);
        env.storage()
            .instance()
            .set(&DataKey::GrantCounter, &id.checked_add(1).expect("grant counter overflow"));

        env.events()
            .publish((symbol_short!("grant_new"), id), amount);

        id
    }

    /// Claims vested tokens for a specific grant.
    pub fn claim(env: Env, grant_id: u32) -> i128 {
        let mut grant: Grant = env
            .storage()
            .persistent()
            .get(&DataKey::Grant(grant_id))
            .expect("grant not found");
        grant.beneficiary.require_auth();

        let current_time = env.ledger().timestamp();
        let vested = Self::calculate_vested_amount(&grant, current_time);
        let claimable = vested - grant.claimed_amount;

        assert!(claimable > 0, "nothing to claim");

        grant.claimed_amount = grant.claimed_amount.checked_add(claimable).expect("claimed overflow");
        env.storage()
            .persistent()
            .set(&DataKey::Grant(grant_id), &grant);

        let token_client = token::Client::new(&env, &grant.token);
        token_client.transfer(
            &env.current_contract_address(),
            &grant.beneficiary,
            &claimable,
        );

        env.events()
            .publish((symbol_short!("claimed"), grant_id), claimable);

        claimable
    }

    pub fn get_grant(env: Env, grant_id: u32) -> Grant {
        env.storage()
            .persistent()
            .get(&DataKey::Grant(grant_id))
            .expect("grant not found")
    }

    pub fn get_claimable_amount(env: Env, grant_id: u32) -> i128 {
        let grant: Grant = env
            .storage()
            .persistent()
            .get(&DataKey::Grant(grant_id))
            .expect("grant not found");
        let current_time = env.ledger().timestamp();
        let vested = Self::calculate_vested_amount(&grant, current_time);
        vested - grant.claimed_amount
    }

    // ========================================================================
    // Internal Logic
    // ========================================================================

    fn calculate_vested_amount(grant: &Grant, current_time: u64) -> i128 {
        // Before cliff
        if current_time < grant.start_time.checked_add(grant.cliff_duration).expect("time overflow") {
            return 0;
        }

        // After full duration
        if current_time >= grant.start_time.checked_add(grant.vesting_duration).expect("time overflow") {
            return grant.total_amount;
        }

        // Linear release
        let elapsed = (current_time - grant.start_time) as i128;
        let duration = grant.vesting_duration as i128;

        grant.total_amount.checked_mul(elapsed).expect("vesting overflow") / duration
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    fn setup_test(
        env: &Env,
    ) -> (
        Address,
        Address,
        Address,
        token::Client,
        VestingContractClient,
    ) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let beneficiary = Address::generate(env);
        let token_admin = Address::generate(env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_client = token::Client::new(env, &token_id);
        let sac_client = token::StellarAssetClient::new(env, &token_id);

        let contract_id = env.register(VestingContract, ());
        let client = VestingContractClient::new(env, &contract_id);

        client.initialize(&admin);
        sac_client.mint(&admin, &1000000);

        (admin, beneficiary, token_id, token_client, client)
    }

    #[test]
    fn test_cliff_logic() {
        let env = Env::default();
        let (_, beneficiary, token_id, _, client) = setup_test(&env);

        let start = 1000;
        let cliff = 500;
        let duration = 1000;
        let amount = 1000;

        let id = client.create_grant(&beneficiary, &token_id, &amount, &start, &cliff, &duration);

        // Before cliff
        env.ledger().with_mut(|l| l.timestamp = start + 499);
        assert_eq!(client.get_claimable_amount(&id), 0);

        // At cliff (should be (500/1000) * 1000 = 500)
        env.ledger().with_mut(|l| l.timestamp = start + 500);
        assert_eq!(client.get_claimable_amount(&id), 500);
    }

    #[test]
    fn test_linear_release() {
        let env = Env::default();
        let (_, beneficiary, token_id, _, client) = setup_test(&env);

        let start = 1000;
        let cliff = 0;
        let duration = 1000;
        let amount = 1000;

        let id = client.create_grant(&beneficiary, &token_id, &amount, &start, &cliff, &duration);

        // Mid-point
        env.ledger().with_mut(|l| l.timestamp = start + 500);
        assert_eq!(client.get_claimable_amount(&id), 500);

        // Claim mid-point
        client.claim(&id);
        assert_eq!(client.get_claimable_amount(&id), 0);

        // End of duration
        env.ledger().with_mut(|l| l.timestamp = start + 1000);
        assert_eq!(client.get_claimable_amount(&id), 500); // Remaining 500
        client.claim(&id);
        assert_eq!(client.get_claimable_amount(&id), 0);
    }

    #[test]
    fn test_multiple_grants() {
        let env = Env::default();
        let (_, beneficiary, token_id, _, client) = setup_test(&env);

        client.create_grant(&beneficiary, &token_id, &1000, &1000, &0, &1000);
        client.create_grant(&beneficiary, &token_id, &2000, &1000, &0, &1000);

        env.ledger().with_mut(|l| l.timestamp = 1500);
        assert_eq!(client.get_claimable_amount(&0), 500);
        assert_eq!(client.get_claimable_amount(&1), 1000);
    }
}
