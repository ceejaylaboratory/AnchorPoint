#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env,
};

#[contracttype]
pub enum DataKey {
    Admin,
    Treasury,
    GovStakers,
    GovShareBps,
}

#[contract]
pub struct RevenueDistributor;

const MAX_BPS: u32 = 10000;

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
    }

    /// Distributes the balance of a specific token held by this contract.
    pub fn distribute(env: Env, token_addr: Address) {
        let gov_share_bps: u32 = env.storage().instance().get(&DataKey::GovShareBps).unwrap();
        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        let gov_stakers: Address = env.storage().instance().get(&DataKey::GovStakers).unwrap();

        let token_client = token::Client::new(&env, &token_addr);
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

        // Emit event for indexer optimization
        env.events().publish(
            (symbol_short!("distrib"), token_addr),
            (gov_amount, treasury_amount),
        );
    }

    /// Mockup of a sweep function that would pull fees from an external contract.
    /// In a real implementation, this would call a 'collect_fees' or 'claim' function
    /// on the target contract where this distributor is the beneficiary.
    pub fn sweep_amm(env: Env, amm_contract: Address, token_a: Address, token_b: Address) {
        // This is a stub for the interaction logic.
        // It demonstrates how the distributor would trigger fee collection.
        // For example: AMMClient::new(&env, &amm_contract).collect_protocol_fees();
        
        env.events().publish(
            (symbol_short!("sweep"), amm_contract),
            (token_a, token_b),
        );
    }

    /// Get current config
    pub fn get_config(env: Env) -> (Address, Address, u32) {
        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        let gov_stakers: Address = env.storage().instance().get(&DataKey::GovStakers).unwrap();
        let gov_share_bps: u32 = env.storage().instance().get(&DataKey::GovShareBps).unwrap();
        (treasury, gov_stakers, gov_share_bps)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _};
    use soroban_sdk::{token, Address, Env};

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
    fn test_zero_balance_distribute() {
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
        distributor_client.initialize(&admin, &treasury, &gov_stakers, &6000);

        // Distributor has no balance — distribute should be a no-op
        distributor_client.distribute(&token_id.address());

        assert_eq!(token_client.balance(&gov_stakers), 0);
        assert_eq!(token_client.balance(&treasury), 0);
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
        let token_client = token::Client::new(&env, &token_id.address());

        let distributor_id = env.register_contract(None, RevenueDistributor);
        let distributor_client = RevenueDistributorClient::new(&env, &distributor_id);
        // 100% to gov_stakers, 0% to treasury
        distributor_client.initialize(&admin, &treasury, &gov_stakers, &10000);

        token::StellarAssetClient::new(&env, &token_id.address()).mint(&distributor_id, &1000);
        distributor_client.distribute(&token_id.address());

        assert_eq!(token_client.balance(&gov_stakers), 1000);
        assert_eq!(token_client.balance(&treasury), 0);
        assert_eq!(token_client.balance(&distributor_id), 0);
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
        // 0% to gov_stakers, 100% to treasury
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

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_client = token::Client::new(&env, &token_id.address());

        let distributor_id = env.register_contract(None, RevenueDistributor);
        let distributor_client = RevenueDistributorClient::new(&env, &distributor_id);
        // 30% gov, 70% treasury
        distributor_client.initialize(&admin, &treasury, &gov_stakers, &3000);

        token::StellarAssetClient::new(&env, &token_id.address()).mint(&distributor_id, &1000);
        distributor_client.distribute(&token_id.address());

        assert_eq!(token_client.balance(&gov_stakers), 300);
        assert_eq!(token_client.balance(&treasury), 700);
        assert_eq!(token_client.balance(&distributor_id), 0);
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
}
