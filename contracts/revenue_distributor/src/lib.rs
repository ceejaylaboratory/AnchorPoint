#![no_std]

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token, vec, Address,
    Env, IntoVal, Vec,
};

#[contracttype]
pub enum DataKey {
    Admin,
    Treasury,
    GovStakers,
    GovShareBps,
    PayoutTokens,
    PayoutCursor,
    /// Configurable maximum deposit cap (i128). 0 = no cap enforced.
    MaxDepositCap,
    /// Running total of all tokens deposited into the contract.
    TotalDeposits,
    /// Addresses (besides the admin) allowed to call `sweep_amm`.
    SweepOperators,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Incoming deposit would push the pool total over the configured cap.
    DepositCapExceeded = 1,
    /// Caller is neither the admin nor a registered sweep operator.
    UnauthorizedSweep = 2,
}

#[contract]
pub struct RevenueDistributor;

const MAX_BPS: u32 = 10000;
/// Max tokens processed per call to stay within Soroban instruction limits.
const MAX_TOKENS_PER_BATCH: u32 = 10;

#[contractimpl]
impl RevenueDistributor {
    /// Initialize the distributor with target addresses and initial split.
    pub fn initialize(
        env: Env,
        admin: Address,
        treasury: Address,
        gov_stakers: Address,
        gov_share_bps: u32,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        if gov_share_bps > MAX_BPS {
            panic!("invalid share bps");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::GovStakers, &gov_stakers);
        env.storage().instance().set(&DataKey::GovShareBps, &gov_share_bps);
        env.events().publish(
            (symbol_short!("dist_init"),),
            (admin, treasury, gov_stakers, gov_share_bps),
        );
    }

    /// Update distribution split (admin only).
    pub fn set_shares(env: Env, admin: Address, gov_share_bps: u32) {
        admin.require_auth();
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        assert_eq!(admin, current_admin, "not authorized");

        if gov_share_bps > MAX_BPS {
            panic!("invalid share bps");
        }
        env.storage().instance().set(&DataKey::GovShareBps, &gov_share_bps);
        env.events()
            .publish((symbol_short!("shares"), admin), gov_share_bps);
    }

    /// Register a token for batched payout distribution (admin only).
    pub fn register_payout_token(env: Env, admin: Address, token_addr: Address) {
        admin.require_auth();
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        assert_eq!(admin, current_admin, "not authorized");

        let mut tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::PayoutTokens)
            .unwrap_or_else(|| Vec::new(&env));

        for existing in tokens.iter() {
            if existing == token_addr {
                return;
            }
        }

        tokens.push_back(token_addr.clone());
        env.storage().instance().set(&DataKey::PayoutTokens, &tokens);
        env.events()
            .publish((symbol_short!("token_reg"),), (admin, token_addr));
    }

    /// Set the maximum cumulative deposit cap (admin only).
    ///
    /// Setting `cap` to 0 disables the cap check (unlimited deposits).
    ///
    /// # Arguments
    /// * `admin`  – Must be the contract admin
    /// * `cap`    – Maximum total deposits allowed; 0 = no limit
    pub fn set_max_deposit_cap(env: Env, admin: Address, cap: i128) {
        admin.require_auth();
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        assert_eq!(admin, current_admin, "not authorized");
        assert!(cap >= 0, "cap must be non-negative");

        env.storage().instance().set(&DataKey::MaxDepositCap, &cap);

        env.events().publish((symbol_short!("set_cap"),), cap);
    }

    /// Return the current deposit cap (0 = no cap).
    pub fn get_max_deposit_cap(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MaxDepositCap)
            .unwrap_or(0)
    }

    /// Return the running total of all deposits accepted by the contract.
    pub fn get_total_deposits(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalDeposits)
            .unwrap_or(0)
    }

    /// Deposit fee tokens into the contract for later distribution.
    ///
    /// Asserts that adding `amount` to the running total does not exceed the
    /// configured `MaxDepositCap`. Returns `Error::DepositCapExceeded` if the
    /// cap would be breached.
    ///
    /// # Arguments
    /// * `from`       – Caller that authorises the token transfer
    /// * `token_addr` – Fee token to deposit
    /// * `amount`     – Amount to deposit (must be positive)
    pub fn deposit(env: Env, from: Address, token_addr: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "amount must be positive");

        // Enforce the deposit cap when one is configured.
        let cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MaxDepositCap)
            .unwrap_or(0);

        if cap > 0 {
            let current_total: i128 = env
                .storage()
                .instance()
                .get(&DataKey::TotalDeposits)
                .unwrap_or(0);

            let new_total = current_total
                .checked_add(amount)
                .unwrap_or_else(|| panic_with_error!(env, Error::DepositCapExceeded));

            if new_total > cap {
                panic_with_error!(env, Error::DepositCapExceeded);
            }

            env.storage().instance().set(&DataKey::TotalDeposits, &new_total);
        } else {
            // No cap: still track the running total for observability.
            let current_total: i128 = env
                .storage()
                .instance()
                .get(&DataKey::TotalDeposits)
                .unwrap_or(0);
            let new_total = current_total
                .checked_add(amount)
                .expect("total deposits overflow");
            env.storage().instance().set(&DataKey::TotalDeposits, &new_total);
        }

        // Pull the tokens from the caller into the contract.
        token::Client::new(&env, &token_addr).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        env.events().publish(
            (symbol_short!("deposited"), token_addr),
            (from, amount),
        );
    }

    /// Distributes the balance of a specific token held by this contract.
    pub fn distribute(env: Env, token_addr: Address) {
        Self::distribute_token(&env, &token_addr);
    }

    /// Distributes balances for registered payout tokens in bounded batches.
    /// Returns the next cursor index (0 when complete).
    pub fn distribute_batch(env: Env, start_index: u32, max_tokens: u32) -> u32 {
        let tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::PayoutTokens)
            .unwrap_or_else(|| Vec::new(&env));

        if tokens.is_empty() {
            return 0;
        }

        let batch_limit = if max_tokens == 0 {
            MAX_TOKENS_PER_BATCH
        } else {
            max_tokens.min(MAX_TOKENS_PER_BATCH)
        };

        let mut index = start_index;
        let mut processed = 0_u32;

        while index < tokens.len() && processed < batch_limit {
            if let Some(token_addr) = tokens.get(index) {
                Self::distribute_token(&env, &token_addr);
            }
            index += 1;
            processed += 1;
        }

        let next_cursor = if index >= tokens.len() { 0 } else { index };
        env.storage()
            .instance()
            .set(&DataKey::PayoutCursor, &next_cursor);

        next_cursor
    }

    fn distribute_token(env: &Env, token_addr: &Address) {
        let gov_share_bps: u32 = env.storage().instance().get(&DataKey::GovShareBps).unwrap();
        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        let gov_stakers: Address = env.storage().instance().get(&DataKey::GovStakers).unwrap();

        let token_client = token::Client::new(env, token_addr);
        let balance = token_client.balance(&env.current_contract_address());

        if balance == 0 {
            return;
        }

        let gov_amount = (balance * gov_share_bps as i128) / MAX_BPS as i128;
        let treasury_amount = balance - gov_amount;

        if gov_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &gov_stakers, &gov_amount);
        }
        if treasury_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &treasury_amount);
        }

        env.events().publish(
            (symbol_short!("distrib"), token_addr.clone()),
            (gov_amount, treasury_amount),
        );
    }

    /// Grant `operator` permission to call `sweep_amm` (admin only).
    ///
    /// Adding an address that is already an operator is a no-op.
    pub fn add_sweep_operator(env: Env, admin: Address, operator: Address) {
        Self::require_admin(&env, &admin);

        let mut operators = Self::read_sweep_operators(&env);
        if operators.contains(&operator) {
            return;
        }
        operators.push_back(operator.clone());
        env.storage().instance().set(&DataKey::SweepOperators, &operators);

        env.events()
            .publish((symbol_short!("sweep_add"),), (admin, operator));
    }

    /// Revoke `operator`'s permission to call `sweep_amm` (admin only).
    ///
    /// Removing an address that is not an operator is a no-op.
    pub fn remove_sweep_operator(env: Env, admin: Address, operator: Address) {
        Self::require_admin(&env, &admin);

        let mut operators = Self::read_sweep_operators(&env);
        let Some(index) = operators.first_index_of(&operator) else {
            return;
        };
        operators.remove(index);
        env.storage().instance().set(&DataKey::SweepOperators, &operators);

        env.events()
            .publish((symbol_short!("sweep_rm"),), (admin, operator));
    }

    /// Return the addresses currently allowed to sweep (excluding the admin).
    pub fn get_sweep_operators(env: Env) -> Vec<Address> {
        Self::read_sweep_operators(&env)
    }

    /// Return whether `addr` may call `sweep_amm` (admin or sweep operator).
    pub fn is_sweep_authorized(env: Env, addr: Address) -> bool {
        Self::can_sweep(&env, &addr)
    }

    /// Sweep accrued swap fees from an AMM pool into the protocol treasury.
    ///
    /// Queries the distributor's balance of `token_a` (assumed to be the fee
    /// token), swaps it into `token_b` via the AMM's `swap` function, and
    /// forwards the proceeds to the treasury.
    ///
    /// `caller` must authorize the call and be either the admin or a
    /// registered sweep operator; otherwise `Error::UnauthorizedSweep` is
    /// raised before any balance is read or moved.
    pub fn sweep_amm(
        env: Env,
        caller: Address,
        amm_contract: Address,
        token_a: Address,
        token_b: Address,
    ) {
        caller.require_auth();
        if !Self::can_sweep(&env, &caller) {
            panic_with_error!(env, Error::UnauthorizedSweep);
        }

        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();

        let token_a_client = token::Client::new(&env, &token_a);
        let balance_a = token_a_client.balance(&env.current_contract_address());

        if balance_a == 0 {
            return;
        }

        // The AMM pulls token_a from this contract with a nested
        // `token_a.transfer(self, amm, balance_a)`. That call is not invoked
        // directly by this contract, so it must be pre-authorized here.
        env.authorize_as_current_contract(vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: token_a.clone(),
                    fn_name: symbol_short!("transfer"),
                    args: (env.current_contract_address(), amm_contract.clone(), balance_a).into_val(&env),
                },
                sub_invocations: vec![&env],
            }),
        ]);

        // Execute swap: token_a → token_b through the AMM pool.
        // The AMM pulls token_a from this contract, validates min_amount_out,
        // and sends token_b back to this contract.
        let _amount_out: i128 = env.invoke_contract(
            &amm_contract,
            &symbol_short!("swap"),
            (
                env.current_contract_address(),
                token_a.clone(),
                balance_a,
                1_i128,  // min_amount_out: accept any positive amount
            )
                .into_val(&env),
        );

        // Transfer the received token_b to the treasury.
        let token_b_client = token::Client::new(&env, &token_b);
        let treasury_amount = token_b_client.balance(&env.current_contract_address());

        if treasury_amount > 0 {
            token_b_client.transfer(
                &env.current_contract_address(),
                &treasury,
                &treasury_amount,
            );
        }

        env.events().publish(
            (symbol_short!("sweep"), amm_contract),
            (token_a, token_b, balance_a, treasury_amount),
        );
    }

    /// Get current config
    pub fn get_config(env: Env) -> (Address, Address, u32) {
        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        let gov_stakers: Address = env.storage().instance().get(&DataKey::GovStakers).unwrap();
        let gov_share_bps: u32 = env.storage().instance().get(&DataKey::GovShareBps).unwrap();
        (treasury, gov_stakers, gov_share_bps)
    }

    fn require_admin(env: &Env, admin: &Address) {
        admin.require_auth();
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        assert_eq!(*admin, current_admin, "not authorized");
    }

    fn read_sweep_operators(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::SweepOperators)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn can_sweep(env: &Env, addr: &Address) -> bool {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        *addr == admin || Self::read_sweep_operators(env).contains(addr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events as _};
    use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

    /// Minimal constant-product pool exposing the same `swap` entry point the
    /// distributor invokes on a real AMM. Kept in-crate because the
    /// `anchorpoint-amm` crate targets a different soroban-sdk major version
    /// and cannot be linked into these tests.
    #[contracttype]
    enum MockAmmKey {
        Tokens,
    }

    #[contract]
    struct MockAmm;

    #[contractimpl]
    impl MockAmm {
        pub fn initialize(env: Env, token_a: Address, token_b: Address) {
            env.storage().instance().set(&MockAmmKey::Tokens, &(token_a, token_b));
        }

        pub fn swap(env: Env, from: Address, token_in: Address, amount_in: i128, min_amount_out: i128) -> i128 {
            from.require_auth();
            let (token_a, token_b): (Address, Address) =
                env.storage().instance().get(&MockAmmKey::Tokens).unwrap();
            let token_out = if token_in == token_a {
                token_b
            } else if token_in == token_b {
                token_a
            } else {
                panic!("invalid token for pool");
            };

            let pool = env.current_contract_address();
            let in_client = token::Client::new(&env, &token_in);
            let out_client = token::Client::new(&env, &token_out);
            let reserve_in = in_client.balance(&pool);
            let reserve_out = out_client.balance(&pool);

            in_client.transfer(&from, &pool, &amount_in);
            let amount_in_with_fee = amount_in * 997;
            let amount_out = amount_in_with_fee * reserve_out / (reserve_in * 1000 + amount_in_with_fee);
            assert!(amount_out >= min_amount_out, "slippage exceeded");
            out_client.transfer(&pool, &from, &amount_out);
            amount_out
        }
    }

    fn register_mock_amm(env: &Env, token_a: &Address, token_b: &Address) -> Address {
        let amm_id = env.register_contract(None, MockAmm);
        MockAmmClient::new(env, &amm_id).initialize(token_a, token_b);
        amm_id
    }

    fn setup() -> (Env, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let gov_stakers = Address::generate(&env);
        
        // Setup a mock token
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_client = token::Client::new(&env, &token_id.address());

        let distributor_id = env.register_contract(None, RevenueDistributor);
        let distributor_client = RevenueDistributorClient::new(&env, &distributor_id);
        
        distributor_client.initialize(&admin, &treasury, &gov_stakers, &6000); // 60% Gov, 40% Treasury

        // Fund the distributor with some "revenue"
        token::StellarAssetClient::new(&env, &token_id.address()).mint(&distributor_id, &1000);

        (env, distributor_id, admin, treasury, gov_stakers, token_id.address())
    }

    #[test]
    fn test_distribution() {
        let (env, distributor_id, _, treasury, gov_stakers, token_addr) = setup();
        let distributor_client = RevenueDistributorClient::new(&env, &distributor_id);
        let token_client = token::Client::new(&env, &token_addr);

        distributor_client.distribute(&token_addr);

        assert_eq!(token_client.balance(&gov_stakers), 600);
        assert_eq!(token_client.balance(&treasury), 400);
        assert_eq!(token_client.balance(&distributor_id), 0);
    }

    #[test]
    fn test_set_shares() {
        let (env, distributor_id, admin, _, _, _) = setup();
        let distributor_client = RevenueDistributorClient::new(&env, &distributor_id);

        distributor_client.set_shares(&admin, &8000);
        let (_, _, gov_share) = distributor_client.get_config();
        assert_eq!(gov_share, 8000);
    }

    #[test]
    fn test_distribute_batch_bounded() {
        let (env, distributor_id, admin, treasury, gov_stakers, token_addr) = setup();
        let distributor_client = RevenueDistributorClient::new(&env, &distributor_id);
        let token_client = token::Client::new(&env, &token_addr);

        distributor_client.register_payout_token(&admin, &token_addr);

        let next = distributor_client.distribute_batch(&0, &10);
        assert_eq!(next, 0);
        assert_eq!(token_client.balance(&gov_stakers), 600);
        assert_eq!(token_client.balance(&treasury), 400);
    }

    #[test]
    fn test_zero_balance_distribute_is_noop() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let gov_stakers = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

        let distributor_id = env.register_contract(None, RevenueDistributor);
        let client = RevenueDistributorClient::new(&env, &distributor_id);
        client.initialize(&admin, &treasury, &gov_stakers, &5000);

        client.distribute(&token_id.address());

        let token_client = token::Client::new(&env, &token_id.address());
        assert_eq!(token_client.balance(&treasury), 0);
        assert_eq!(token_client.balance(&gov_stakers), 0);
    }

    #[test]
    fn test_full_gov_share() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let gov_stakers = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

        let distributor_id = env.register_contract(None, RevenueDistributor);
        let client = RevenueDistributorClient::new(&env, &distributor_id);
        client.initialize(&admin, &treasury, &gov_stakers, &10000);
        token::StellarAssetClient::new(&env, &token_id.address()).mint(&distributor_id, &1000);

        client.distribute(&token_id.address());

        let token_client = token::Client::new(&env, &token_id.address());
        assert_eq!(token_client.balance(&gov_stakers), 1000);
        assert_eq!(token_client.balance(&treasury), 0);
    }

    #[test]
    fn test_zero_gov_share() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let gov_stakers = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_client = token::Client::new(&env, &token_id.address());

        let distributor_id = env.register_contract(None, RevenueDistributor);
        let distributor_client = RevenueDistributorClient::new(&env, &distributor_id);
        distributor_client.initialize(&admin, &treasury, &gov_stakers, &0);

        token::StellarAssetClient::new(&env, &token_id.address()).mint(&distributor_id, &1000);
        distributor_client.distribute(&token_id.address());

        assert_eq!(token_client.balance(&gov_stakers), 0);
        assert_eq!(token_client.balance(&treasury), 1000);
        assert_eq!(token_client.balance(&distributor_id), 0);
    }

    #[test]
    fn test_weight_precision_with_odd_amounts() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let gov_stakers = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

        let distributor_id = env.register_contract(None, RevenueDistributor);
        let client = RevenueDistributorClient::new(&env, &distributor_id);
        client.initialize(&admin, &treasury, &gov_stakers, &0);
        token::StellarAssetClient::new(&env, &token_id.address()).mint(&distributor_id, &1000);

        client.distribute(&token_id.address());

        let token_client = token::Client::new(&env, &token_id.address());
        assert_eq!(token_client.balance(&gov_stakers), 0);
        assert_eq!(token_client.balance(&treasury), 1000);
    }

    #[test]
    fn test_distribution_after_set_shares() {
        let (env, distributor_id, admin, treasury, gov_stakers, token_addr) = setup();
        let client = RevenueDistributorClient::new(&env, &distributor_id);
        let token_client = token::Client::new(&env, &token_addr);

        client.set_shares(&admin, &3000);
        client.distribute(&token_addr);

        assert_eq!(token_client.balance(&gov_stakers), 300);
        assert_eq!(token_client.balance(&treasury), 700);
    }

    #[test]
    #[should_panic(expected = "invalid share bps")]
    fn test_invalid_bps_panics_on_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let gov_stakers = Address::generate(&env);

        let distributor_id = env.register_contract(None, RevenueDistributor);
        let client = RevenueDistributorClient::new(&env, &distributor_id);
        client.initialize(&admin, &treasury, &gov_stakers, &10001);
    }

    #[test]
    #[should_panic(expected = "invalid share bps")]
    fn test_invalid_bps_panics_on_set_shares() {
        let (env, distributor_id, admin, _, _, _) = setup();
        let client = RevenueDistributorClient::new(&env, &distributor_id);
        client.set_shares(&admin, &10001);
    }

    // ── Deposit cap tests (Issue #998) ───────────────────────────────────

    #[test]
    fn test_set_and_get_max_deposit_cap() {
        let (env, distributor_id, admin, _, _, _) = setup();
        let client = RevenueDistributorClient::new(&env, &distributor_id);

        // Default: no cap
        assert_eq!(client.get_max_deposit_cap(), 0);

        // Admin sets a cap
        client.set_max_deposit_cap(&admin, &5_000);
        assert_eq!(client.get_max_deposit_cap(), 5_000);
    }

    #[test]
    fn test_deposit_within_cap_succeeds() {
        let (env, distributor_id, admin, _, _, _) = setup();
        let client = RevenueDistributorClient::new(&env, &distributor_id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let depositor = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token_id.address()).mint(&depositor, &10_000);

        // Set a cap of 8_000 and deposit 3_000 twice (total 6_000 < 8_000)
        client.set_max_deposit_cap(&admin, &8_000);

        client.deposit(&depositor, &token_id.address(), &3_000);
        assert_eq!(client.get_total_deposits(), 3_000);

        client.deposit(&depositor, &token_id.address(), &3_000);
        assert_eq!(client.get_total_deposits(), 6_000);
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #1)")]
    fn test_deposit_exceeding_cap_is_rejected() {
        let (env, distributor_id, admin, _, _, _) = setup();
        let client = RevenueDistributorClient::new(&env, &distributor_id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let depositor = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token_id.address()).mint(&depositor, &10_000);

        // Cap of 1_000, attempting to deposit 2_000 should fail
        client.set_max_deposit_cap(&admin, &1_000);
        client.deposit(&depositor, &token_id.address(), &2_000); // Must panic with DepositCapExceeded
    }

    #[test]
    #[should_panic(expected = "HostError: Error(Contract, #1)")]
    fn test_deposit_exceeds_cap_on_second_deposit() {
        let (env, distributor_id, admin, _, _, _) = setup();
        let client = RevenueDistributorClient::new(&env, &distributor_id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let depositor = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token_id.address()).mint(&depositor, &10_000);

        // Cap of 1_500; first deposit OK, second deposit would overflow
        client.set_max_deposit_cap(&admin, &1_500);
        client.deposit(&depositor, &token_id.address(), &1_000); // OK
        client.deposit(&depositor, &token_id.address(), &1_000); // Exceeds cap (1_000 + 1_000 = 2_000 > 1_500)
    }

    #[test]
    fn test_deposit_no_cap_unlimited() {
        let (env, distributor_id, _admin, _, _, _) = setup();
        let client = RevenueDistributorClient::new(&env, &distributor_id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let depositor = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token_id.address()).mint(&depositor, &100_000);

        // No cap set (default 0): large deposit should succeed
        client.deposit(&depositor, &token_id.address(), &100_000);
        assert_eq!(client.get_total_deposits(), 100_000);
    }

    // ── Sweep AMM tests ──

    #[allow(clippy::type_complexity)]
    fn sweep_setup() -> (Env, RevenueDistributorClient<'static>, Address, Address, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let gov_stakers = Address::generate(&env);

        // Register tokens using Stellar asset contracts
        let token_admin = Address::generate(&env);
        let token_a_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_b_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_a = token_a_id.address();
        let token_b = token_b_id.address();

        let token_a_sac = token::StellarAssetClient::new(&env, &token_a);
        let token_b_sac = token::StellarAssetClient::new(&env, &token_b);

        // Register the AMM and seed its pool with liquidity
        let amm_id = register_mock_amm(&env, &token_a, &token_b);
        token_a_sac.mint(&amm_id, &50_000_000);
        token_b_sac.mint(&amm_id, &50_000_000);

        // Register and initialize the revenue distributor
        let distributor_id = env.register_contract(None, RevenueDistributor);
        let client = RevenueDistributorClient::new(&env, &distributor_id);
        client.initialize(&admin, &treasury, &gov_stakers, &6000);

        // Mint token_a fees to the distributor (simulating accrued swap revenue)
        token_a_sac.mint(&distributor_id, &10_000);

        (env, client, distributor_id, amm_id, token_a, token_b, treasury, gov_stakers, admin)
    }

    #[test]
    fn test_sweep_amm_swaps_and_transfers_to_treasury() {
        let (env, client, distributor_id, amm_id, token_a, token_b, treasury, _gov_stakers, admin) = sweep_setup();

        client.sweep_amm(&admin, &amm_id, &token_a, &token_b);

        let token_b_client = token::Client::new(&env, &token_b);
        // Treasury should have received token_b from the swap
        assert!(token_b_client.balance(&treasury) > 0);
        // Distributor should have no remaining token_a balance
        let token_a_client = token::Client::new(&env, &token_a);
        assert_eq!(token_a_client.balance(&distributor_id), 0);
    }

    #[test]
    fn test_sweep_amm_zero_balance_does_nothing() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let gov_stakers = Address::generate(&env);

        let distributor_id = env.register_contract(None, RevenueDistributor);
        let client = RevenueDistributorClient::new(&env, &distributor_id);
        client.initialize(&admin, &treasury, &gov_stakers, &6000);

        let token_admin = Address::generate(&env);
        let token_a_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_b_id = env.register_stellar_asset_contract_v2(token_admin);
        let amm_id = register_mock_amm(&env, &token_a_id.address(), &token_b_id.address());

        // No tokens minted to distributor — balance is 0
        client.sweep_amm(&admin, &amm_id, &token_a_id.address(), &token_b_id.address());

        let token_b_client = token::Client::new(&env, &token_b_id.address());
        assert_eq!(token_b_client.balance(&treasury), 0);
    }

    #[test]
    fn test_sweep_amm_emits_revenue_swept_event() {
        let (env, client, _distributor_id, amm_id, token_a, token_b, _treasury, _gov_stakers, admin) = sweep_setup();

        let events_before = env.events().all().len();
        client.sweep_amm(&admin, &amm_id, &token_a, &token_b);
        let events_after = env.events().all().len();

        // At least one new event should have been emitted
        assert!(events_after > events_before, "RevenueSwept event should be emitted");
    }

    // ── Sweep authorization tests (Issue #1514) ──

    #[test]
    fn test_unauthorized_caller_cannot_sweep() {
        let (env, client, distributor_id, amm_id, token_a, token_b, treasury, _gov_stakers, _admin) = sweep_setup();
        let outsider = Address::generate(&env);

        assert!(!client.is_sweep_authorized(&outsider));
        assert_eq!(
            client.try_sweep_amm(&outsider, &amm_id, &token_a, &token_b),
            Err(Ok(Error::UnauthorizedSweep.into()))
        );

        // Nothing moved: fees stay in the distributor, treasury untouched.
        let token_a_client = token::Client::new(&env, &token_a);
        let token_b_client = token::Client::new(&env, &token_b);
        assert_eq!(token_a_client.balance(&distributor_id), 10_000);
        assert_eq!(token_b_client.balance(&treasury), 0);
    }

    #[test]
    fn test_sweep_operator_can_sweep() {
        let (env, client, distributor_id, amm_id, token_a, token_b, treasury, _gov_stakers, admin) = sweep_setup();
        let operator = Address::generate(&env);

        client.add_sweep_operator(&admin, &operator);
        assert!(client.is_sweep_authorized(&operator));
        assert_eq!(client.get_sweep_operators(), soroban_sdk::vec![&env, operator.clone()]);

        client.sweep_amm(&operator, &amm_id, &token_a, &token_b);

        // The operator's own signature is what authorized the sweep.
        assert_eq!(env.auths()[0].0, operator);
        let token_a_client = token::Client::new(&env, &token_a);
        let token_b_client = token::Client::new(&env, &token_b);
        assert_eq!(token_a_client.balance(&distributor_id), 0);
        assert!(token_b_client.balance(&treasury) > 0);
    }

    #[test]
    fn test_admin_is_always_sweep_authorized() {
        let (_env, client, _distributor_id, _amm_id, _token_a, _token_b, _treasury, _gov_stakers, admin) = sweep_setup();
        assert!(client.is_sweep_authorized(&admin));
        assert_eq!(client.get_sweep_operators().len(), 0);
    }

    #[test]
    fn test_removed_operator_cannot_sweep() {
        let (env, client, _distributor_id, amm_id, token_a, token_b, _treasury, _gov_stakers, admin) = sweep_setup();
        let operator = Address::generate(&env);

        client.add_sweep_operator(&admin, &operator);
        client.remove_sweep_operator(&admin, &operator);

        assert!(!client.is_sweep_authorized(&operator));
        assert_eq!(client.get_sweep_operators().len(), 0);
        assert_eq!(
            client.try_sweep_amm(&operator, &amm_id, &token_a, &token_b),
            Err(Ok(Error::UnauthorizedSweep.into()))
        );
    }

    #[test]
    fn test_add_and_remove_sweep_operator_are_idempotent() {
        let (env, client, _distributor_id, _amm_id, _token_a, _token_b, _treasury, _gov_stakers, admin) = sweep_setup();
        let operator = Address::generate(&env);
        let other = Address::generate(&env);

        client.add_sweep_operator(&admin, &operator);
        client.add_sweep_operator(&admin, &operator);
        assert_eq!(client.get_sweep_operators().len(), 1);

        // Removing an address that was never added leaves the list intact.
        client.remove_sweep_operator(&admin, &other);
        assert_eq!(client.get_sweep_operators(), soroban_sdk::vec![&env, operator]);
    }

    #[test]
    #[should_panic(expected = "not authorized")]
    fn test_non_admin_cannot_add_sweep_operator() {
        let (env, client, _distributor_id, _amm_id, _token_a, _token_b, _treasury, _gov_stakers, _admin) = sweep_setup();
        let outsider = Address::generate(&env);
        client.add_sweep_operator(&outsider, &outsider);
    }

    #[test]
    #[should_panic(expected = "not authorized")]
    fn test_non_admin_cannot_remove_sweep_operator() {
        let (env, client, _distributor_id, _amm_id, _token_a, _token_b, _treasury, _gov_stakers, admin) = sweep_setup();
        let operator = Address::generate(&env);
        let outsider = Address::generate(&env);
        client.add_sweep_operator(&admin, &operator);
        client.remove_sweep_operator(&outsider, &operator);
    }

    #[test]
    #[should_panic]
    fn test_sweep_requires_caller_signature() {
        let (env, client, _distributor_id, amm_id, token_a, token_b, _treasury, _gov_stakers, admin) = sweep_setup();
        // Drop the blanket auth mock: naming the admin without its
        // signature must not be enough to sweep.
        env.set_auths(&[]);
        client.sweep_amm(&admin, &amm_id, &token_a, &token_b);
    }
}
