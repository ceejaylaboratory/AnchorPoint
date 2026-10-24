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
    pub revocable: bool,
    pub revoked: bool,
}

#[contract]
pub struct VestingContract;

#[allow(deprecated)]
#[allow(clippy::too_many_arguments)]
#[contractimpl]
impl VestingContract {
    /// Initializes the contract with an admin.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::GrantCounter, &0u32);
        env.events().publish((symbol_short!("init"),), admin);
    }

    /// Transfers administrative rights to a new address.
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events()
            .publish((symbol_short!("admin_set"), admin), new_admin);
    }

    /// Creates a new vesting grant.
    /// The admin must provide the tokens upfront.
    #[allow(clippy::too_many_arguments)]
    pub fn create_grant(
        env: Env,
        beneficiary: Address,
        token: Address,
        amount: i128,
        start_time: u64,
        cliff_duration: u64,
        vesting_duration: u64,
        revocable: bool,
    ) -> u32 {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        assert!(amount > 0, "amount must be positive");
        assert!(vesting_duration > 0, "duration must be positive");
        assert!(cliff_duration <= vesting_duration, "cliff exceeds duration");

        // Deposit tokens into the contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&admin, env.current_contract_address(), &amount);

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
            revocable,
            revoked: false,
        };

        env.storage().persistent().set(&DataKey::Grant(id), &grant);
        env.storage().instance().set(
            &DataKey::GrantCounter,
            &id.checked_add(1).expect("grant counter overflow"),
        );

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

        grant.claimed_amount = grant
            .claimed_amount
            .checked_add(claimable)
            .expect("claimed overflow");
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

    /// Revokes a grant, returning unvested tokens to the admin.
    pub fn revoke_grant(env: Env, grant_id: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let mut grant: Grant = env
            .storage()
            .persistent()
            .get(&DataKey::Grant(grant_id))
            .expect("grant not found");

        assert!(grant.revocable, "grant is not revocable");
        assert!(!grant.revoked, "grant is already revoked");

        let current_time = env.ledger().timestamp();
        let vested = Self::calculate_vested_amount(&grant, current_time);
        let unvested = grant.total_amount - vested;

        if unvested > 0 {
            let token_client = token::Client::new(&env, &grant.token);
            token_client.transfer(&env.current_contract_address(), &admin, &unvested);
        }

        grant.total_amount = vested;
        grant.revoked = true;

        env.storage()
            .persistent()
            .set(&DataKey::Grant(grant_id), &grant);

        env.events()
            .publish((symbol_short!("revoked"), grant_id), unvested);
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
        // If revoked, the total_amount has already been capped at the vested amount
        // at the time of revocation.
        if grant.revoked {
            return grant.total_amount;
        }

        // 1. Cliff logic check: Calculate cliff_timestamp
        let cliff_timestamp = grant
            .start_time
            .checked_add(grant.cliff_duration)
            .expect("time overflow");

        // Check current_time < cliff_timestamp: return 0 unlocked tokens.
        if current_time < cliff_timestamp {
            return 0;
        }

        // 2. Cap logic check: Calculate end_timestamp
        let end_timestamp = grant
            .start_time
            .checked_add(grant.vesting_duration)
            .expect("time overflow");

        // Cap unlocked amount at total allocated tokens.
        if current_time >= end_timestamp {
            return grant.total_amount;
        }

        // 3. Linear calculation: unlocked = total_amount * (current_time - start_time) / vesting_duration
        // It is mathematically safe to subtract here because we have already validated
        // that current_time >= cliff_timestamp, and cliff_timestamp >= start_time.
        let elapsed = (current_time - grant.start_time) as i128;
        let duration = grant.vesting_duration as i128;

        grant
            .total_amount
            .checked_mul(elapsed)
            .expect("vesting overflow")
            / duration
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
        token::Client<'_>,
        VestingContractClient<'_>,
    ) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let beneficiary = Address::generate(env);
        let token_admin = Address::generate(env);
        let token_id = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
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

        let id = client.create_grant(
            &beneficiary,
            &token_id,
            &amount,
            &start,
            &cliff,
            &duration,
            &false,
        );

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

        let id = client.create_grant(
            &beneficiary,
            &token_id,
            &amount,
            &start,
            &cliff,
            &duration,
            &false,
        );

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
    fn test_revocation() {
        let env = Env::default();
        let (admin, beneficiary, token_id, token_client, client) = setup_test(&env);

        let start = 1000;
        let cliff = 0;
        let duration = 1000;
        let amount = 1000;

        let id = client.create_grant(
            &beneficiary,
            &token_id,
            &amount,
            &start,
            &cliff,
            &duration,
            &true,
        );

        // Advance to mid-point
        env.ledger().with_mut(|l| l.timestamp = start + 500);
        assert_eq!(client.get_claimable_amount(&id), 500);

        // Revoke grant
        client.revoke_grant(&id);

        // Beneficiary can still claim what was vested at revocation
        assert_eq!(client.get_claimable_amount(&id), 500);
        client.claim(&id);
        assert_eq!(client.get_claimable_amount(&id), 0);

        // No more vesting occurs
        env.ledger().with_mut(|l| l.timestamp = start + 1000);
        assert_eq!(client.get_claimable_amount(&id), 0);

        // Admin received unvested tokens
        assert_eq!(token_client.balance(&admin), 1000000 - 1000 + 500);
    }

    #[test]
    #[should_panic(expected = "grant is not revocable")]
    fn test_non_revocable_panic() {
        let env = Env::default();
        let (_, beneficiary, token_id, _, client) = setup_test(&env);

        let id = client.create_grant(&beneficiary, &token_id, &1000, &1000, &0, &1000, &false);
        client.revoke_grant(&id);
    }

    /// After revoking, the beneficiary can claim what was vested at revocation.
    /// Once they claim that amount, any further claim must panic with "nothing to claim".
    #[test]
    #[should_panic(expected = "nothing to claim")]
    fn test_claim_on_fully_claimed_revoked_grant_panics() {
        let env = Env::default();
        let (_, beneficiary, token_id, _, client) = setup_test(&env);

        let start = 1000;
        let cliff = 0;
        let duration = 1000;
        let amount = 1000;

        let id = client.create_grant(
            &beneficiary,
            &token_id,
            &amount,
            &start,
            &cliff,
            &duration,
            &true, // revocable
        );

        // Advance to mid-point: 500 tokens vested.
        env.ledger().with_mut(|l| l.timestamp = start + 500);

        // Revoke the grant — unvested (500) back to admin.
        client.revoke_grant(&id);

        // Beneficiary claims the 500 vested tokens.
        client.claim(&id);

        // Second claim on the now-fully-claimed revoked grant must panic.
        client.claim(&id);
    }

    /// Revoke a grant before the cliff: all tokens go back to admin, beneficiary
    /// gets nothing (vested = 0 at time of revocation). Any subsequent claim panics.
    #[test]
    #[should_panic(expected = "nothing to claim")]
    fn test_claim_after_pre_cliff_revocation_panics() {
        let env = Env::default();
        let (admin, beneficiary, token_id, token_client, client) = setup_test(&env);

        let start = 1000;
        let cliff = 500;
        let duration = 1000;
        let amount = 1000;

        let id = client.create_grant(
            &beneficiary,
            &token_id,
            &amount,
            &start,
            &cliff,
            &duration,
            &true,
        );

        let admin_balance_before = token_client.balance(&admin);

        // Revoke before cliff: all 1000 tokens back to admin (vested = 0).
        env.ledger().with_mut(|l| l.timestamp = start + 100);
        client.revoke_grant(&id);

        // Admin should have received all tokens back.
        assert_eq!(token_client.balance(&admin), admin_balance_before + amount);

        // grant.total_amount is now 0 (vested = 0 at revocation).
        // claimable = 0 - 0 = 0 → panics with "nothing to claim".
        client.claim(&id);
    }

    /// Verify that nothing is claimable at any point strictly before the cliff.
    #[test]
    fn test_cliff_no_tokens_before_cliff() {
        let env = Env::default();
        let (_, beneficiary, token_id, _, client) = setup_test(&env);

        let start: u64 = 1000;
        let cliff: u64 = 600;
        let duration: u64 = 1000;
        let amount: i128 = 2000;

        let id = client.create_grant(
            &beneficiary,
            &token_id,
            &amount,
            &start,
            &cliff,
            &duration,
            &false,
        );

        // t = start (no time elapsed)
        env.ledger().with_mut(|l| l.timestamp = start);
        assert_eq!(client.get_claimable_amount(&id), 0, "should be 0 at start");

        // t = start + cliff - 1 (one second before cliff)
        env.ledger().with_mut(|l| l.timestamp = start + cliff - 1);
        assert_eq!(
            client.get_claimable_amount(&id),
            0,
            "should be 0 one second before cliff"
        );
    }

    /// Verify linear release between cliff and end, and that claimed tokens
    /// cannot exceed total_amount.
    #[test]
    fn test_cliff_and_post_vesting_payout() {
        let env = Env::default();
        let (_, beneficiary, token_id, _, client) = setup_test(&env);

        let start: u64 = 0;
        let cliff: u64 = 250;
        let duration: u64 = 1000;
        let amount: i128 = 1000;

        let id = client.create_grant(
            &beneficiary,
            &token_id,
            &amount,
            &start,
            &cliff,
            &duration,
            &false,
        );

        // At the cliff: 250/1000 * 1000 = 250 vested
        env.ledger().with_mut(|l| l.timestamp = cliff);
        assert_eq!(client.get_claimable_amount(&id), 250);

        // At 500 (halfway): 500/1000 * 1000 = 500 vested, 250 already claimable
        env.ledger().with_mut(|l| l.timestamp = 500);
        assert_eq!(client.get_claimable_amount(&id), 500);

        // Claim 500
        client.claim(&id);
        assert_eq!(client.get_claimable_amount(&id), 0);

        // At full duration: entire remaining 500 is claimable
        env.ledger().with_mut(|l| l.timestamp = duration);
        assert_eq!(client.get_claimable_amount(&id), 500);
        client.claim(&id);
        assert_eq!(client.get_claimable_amount(&id), 0);

        // After full vesting: no more tokens (claimed_amount == total_amount)
        env.ledger().with_mut(|l| l.timestamp = duration + 999);
        assert_eq!(client.get_claimable_amount(&id), 0);
    }

    /// Verify that a zero-cliff grant starts vesting immediately from start_time.
    #[test]
    fn test_zero_cliff_vests_immediately() {
        let env = Env::default();
        let (_, beneficiary, token_id, _, client) = setup_test(&env);

        let start: u64 = 500;
        let duration: u64 = 1000;
        let amount: i128 = 1000;

        let id = client.create_grant(
            &beneficiary,
            &token_id,
            &amount,
            &start,
            &0,    // zero cliff
            &duration,
            &false,
        );

        // Any time >= start should yield tokens
        env.ledger().with_mut(|l| l.timestamp = start + 1);
        assert!(client.get_claimable_amount(&id) > 0);
    }

    /// Verify nothing can be claimed before start_time (start_time acts like a cliff of 0).
    #[test]
    fn test_nothing_claimable_before_start() {
        let env = Env::default();
        let (_, beneficiary, token_id, _, client) = setup_test(&env);

        let start: u64 = 1000;
        let id = client.create_grant(
            &beneficiary,
            &token_id,
            &500,
            &start,
            &0,
            &500,
            &false,
        );

        // Before start
        env.ledger().with_mut(|l| l.timestamp = start - 1);
        assert_eq!(client.get_claimable_amount(&id), 0);
    }

    /// Ensure total claimed never exceeds total_amount even at time far past vesting end.
    #[test]
    fn test_total_claimed_cannot_exceed_total_amount() {
        let env = Env::default();
        let (_, beneficiary, token_id, token_client, client) = setup_test(&env);

        let start: u64 = 0;
        let duration: u64 = 1000;
        let amount: i128 = 1000;

        let id = client.create_grant(
            &beneficiary,
            &token_id,
            &amount,
            &start,
            &0,
            &duration,
            &false,
        );

        // Jump to far future
        env.ledger().with_mut(|l| l.timestamp = duration * 10);
        client.claim(&id);

        // Balance of beneficiary should equal exactly total_amount
        assert_eq!(token_client.balance(&beneficiary), amount);

        // No more tokens claimable
        assert_eq!(client.get_claimable_amount(&id), 0);
    }

    /// Ensure cliff equal to vesting_duration means all tokens vest at the end.
    #[test]
    fn test_cliff_equals_duration_all_at_end() {
        let env = Env::default();
        let (_, beneficiary, token_id, _, client) = setup_test(&env);

        let start: u64 = 0;
        let duration: u64 = 1000;

        let id = client.create_grant(
            &beneficiary,
            &token_id,
            &1000,
            &start,
            &duration, // cliff == duration
            &duration,
            &false,
        );

        // Just before end: nothing (cliff not yet reached)
        env.ledger().with_mut(|l| l.timestamp = duration - 1);
        assert_eq!(client.get_claimable_amount(&id), 0);

        // At end: full amount
        env.ledger().with_mut(|l| l.timestamp = duration);
        assert_eq!(client.get_claimable_amount(&id), 1000);
    }
}
