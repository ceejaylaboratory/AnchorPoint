#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Vec, IntoVal
};

const PRECISION: i128 = 1_000_000_000_000_000_000;

#[contracttype]
pub enum DataKey {
    Admin,
    StakeToken,
    RewardToken,
    NftContract,
    TotalStaked,
    RewardPerTokenStored,
    StakeAmount(u64),             // NFT ID -> Staked amount
    StakeLockTime(u64),           // NFT ID -> Lock expiration timestamp
    NftRewardPerTokenPaid(u64),   // NFT ID -> Snapshot
    NftRewards(u64),              // NFT ID -> Accrued rewards
}

#[contracttype]
pub struct StakeInfo {
    pub token_id: u64,
    pub amount: i128,
    pub lock_time: u64,
    pub pending_rewards: i128,
}

#[contract]
pub struct LiquidStaking;

#[contractimpl]
impl LiquidStaking {
    pub fn initialize(
        env: Env,
        admin: Address,
        stake_token: Address,
        reward_token: Address,
        nft_contract: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StakeToken, &stake_token);
        env.storage().instance().set(&DataKey::RewardToken, &reward_token);
        env.storage().instance().set(&DataKey::NftContract, &nft_contract);
        env.storage().instance().set(&DataKey::TotalStaked, &0_i128);
        env.storage().instance().set(&DataKey::RewardPerTokenStored, &0_i128);
    }

    pub fn deposit_rewards(env: Env, from: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "amount must be positive");

        let total_staked: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);

        let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
        token::Client::new(&env, &reward_token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        if total_staked > 0 {
            let mut rpt: i128 = env
                .storage()
                .instance()
                .get(&DataKey::RewardPerTokenStored)
                .unwrap_or(0);
            rpt += amount * PRECISION / total_staked;
            env.storage()
                .instance()
                .set(&DataKey::RewardPerTokenStored, &rpt);
        }

        env.events().publish((symbol_short!("dep_rwd"), from), amount);
    }

    pub fn stake(env: Env, user: Address, amount: i128, lock_duration: u64) -> u64 {
        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &user,
            &env.current_contract_address(),
            &amount,
        );

        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).unwrap();
        
        let name = String::from_str(&env, "Liquid Stake Receipt");
        let description = String::from_str(&env, "Represents a staked position.");
        let image = String::from_str(&env, "");

        let token_id: u64 = env.invoke_contract(
            &nft_contract,
            &symbol_short!("mint"),
            (
                env.current_contract_address(),
                user.clone(),
                name,
                description,
                image,
                0_u32, // royalty
                true,  // mutable
            ).into_val(&env),
        );

        env.storage().persistent().set(&DataKey::StakeAmount(token_id), &amount);
        let lock_time = env.ledger().timestamp() + lock_duration;
        env.storage().persistent().set(&DataKey::StakeLockTime(token_id), &lock_time);

        let rpt: i128 = env.storage().instance().get(&DataKey::RewardPerTokenStored).unwrap_or(0);
        env.storage().persistent().set(&DataKey::NftRewardPerTokenPaid(token_id), &rpt);
        env.storage().persistent().set(&DataKey::NftRewards(token_id), &0_i128);

        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &(total + amount));

        env.events().publish((symbol_short!("staked"), user, token_id), (amount, lock_time));
        
        token_id
    }

    pub fn unstake(env: Env, user: Address, token_id: u64) {
        user.require_auth();
        
        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).unwrap();
        let owner: Address = env.invoke_contract(
            &nft_contract,
            &symbol_short!("owner_of"),
            (token_id,).into_val(&env),
        );
        assert_eq!(user, owner, "not token owner");

        let lock_time: u64 = env.storage().persistent().get(&DataKey::StakeLockTime(token_id)).unwrap_or(0);
        assert!(env.ledger().timestamp() >= lock_time, "stake is locked");

        let amount: i128 = env.storage().persistent().get(&DataKey::StakeAmount(token_id)).unwrap_or(0);
        assert!(amount > 0, "no stake found for token");

        Self::_update_reward(&env, token_id);

        let reward: i128 = env.storage().persistent().get(&DataKey::NftRewards(token_id)).unwrap_or(0);
        if reward > 0 {
            let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
            token::Client::new(&env, &reward_token).transfer(
                &env.current_contract_address(),
                &user,
                &reward,
            );
        }

        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &(total - amount));

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &env.current_contract_address(),
            &user,
            &amount,
        );

        env.storage().persistent().remove(&DataKey::StakeAmount(token_id));
        env.storage().persistent().remove(&DataKey::StakeLockTime(token_id));
        env.storage().persistent().remove(&DataKey::NftRewardPerTokenPaid(token_id));
        env.storage().persistent().remove(&DataKey::NftRewards(token_id));

        // Burn the NFT
        env.invoke_contract::<()>(
            &nft_contract,
            &symbol_short!("burn"),
            (env.current_contract_address(), token_id).into_val(&env),
        );

        env.events().publish((symbol_short!("unstaked"), user, token_id), amount);
    }

    pub fn claim(env: Env, user: Address, token_id: u64) -> i128 {
        user.require_auth();

        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).unwrap();
        let owner: Address = env.invoke_contract(
            &nft_contract,
            &symbol_short!("owner_of"),
            (token_id,).into_val(&env),
        );
        assert_eq!(user, owner, "not token owner");

        Self::_update_reward(&env, token_id);

        let reward: i128 = env.storage().persistent().get(&DataKey::NftRewards(token_id)).unwrap_or(0);

        if reward > 0 {
            env.storage().persistent().set(&DataKey::NftRewards(token_id), &0_i128);

            let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
            token::Client::new(&env, &reward_token).transfer(
                &env.current_contract_address(),
                &user,
                &reward,
            );

            env.events().publish((symbol_short!("claimed"), user, token_id), reward);
        }

        reward
    }

    pub fn get_stake_info(env: Env, token_id: u64) -> StakeInfo {
        let rpt: i128 = env.storage().instance().get(&DataKey::RewardPerTokenStored).unwrap_or(0);
        let nft_rpt: i128 = env.storage().persistent().get(&DataKey::NftRewardPerTokenPaid(token_id)).unwrap_or(0);
        let amount: i128 = env.storage().persistent().get(&DataKey::StakeAmount(token_id)).unwrap_or(0);
        let accrued: i128 = env.storage().persistent().get(&DataKey::NftRewards(token_id)).unwrap_or(0);
        
        let pending = accrued + amount * (rpt - nft_rpt) / PRECISION;
        let lock_time: u64 = env.storage().persistent().get(&DataKey::StakeLockTime(token_id)).unwrap_or(0);

        StakeInfo {
            token_id,
            amount,
            lock_time,
            pending_rewards: pending,
        }
    }

    fn _update_reward(env: &Env, token_id: u64) {
        let rpt: i128 = env.storage().instance().get(&DataKey::RewardPerTokenStored).unwrap_or(0);
        let nft_rpt: i128 = env.storage().persistent().get(&DataKey::NftRewardPerTokenPaid(token_id)).unwrap_or(0);
        let amount: i128 = env.storage().persistent().get(&DataKey::StakeAmount(token_id)).unwrap_or(0);
        let earned = amount * (rpt - nft_rpt) / PRECISION;

        if earned > 0 {
            let prev: i128 = env.storage().persistent().get(&DataKey::NftRewards(token_id)).unwrap_or(0);
            env.storage().persistent().set(&DataKey::NftRewards(token_id), &(prev + earned));
        }

        env.storage().persistent().set(&DataKey::NftRewardPerTokenPaid(token_id), &rpt);
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, String,
    };
    
    // Using the imported Rust crate directly for tests

    fn setup() -> (Env, Address, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let stake_token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let reward_token_id = env.register_stellar_asset_contract_v2(admin.clone());

        let stake_sac = StellarAssetClient::new(&env, &stake_token_id.address());
        let reward_sac = StellarAssetClient::new(&env, &reward_token_id.address());

        stake_sac.mint(&alice, &1_000_000);
        stake_sac.mint(&bob, &1_000_000);
        reward_sac.mint(&admin, &10_000_000);

        // Register the NFT Contract natively instead of importing Wasm, it's easier and cleaner in multi-crate tests if we can,
        // but since we added `burn` to it, we'd need to bring the actual crate in.
        // Actually, for simplicity in tests, we can just use the compiled WASM or register the struct if we import it.
        // To avoid compiling issues with path in mock test, let's just assume we need to import it as a dev dependency.
        
        // Let's register a mock NFT contract here for test simplicity, since soroban multi-contract tests can be tricky without compiled wasms.
        
        // Wait, we have the `nft_metadata` crate in dev-dependencies! 
        // So we can do:
        let nft_contract_id = env.register_contract(None, nft_metadata::NftMetadataContract);
        let nft_client = nft_metadata::NftMetadataContractClient::new(&env, &nft_contract_id);
        
        let ls_contract_id = env.register_contract(None, LiquidStaking);
        let ls_client = LiquidStakingClient::new(&env, &ls_contract_id);
        
        // Init NFT contract with LS as admin
        nft_client.initialize(
            &ls_contract_id, 
            &String::from_str(&env, "Liquid Stake"), 
            &String::from_str(&env, "LS")
        );

        ls_client.initialize(&admin, &stake_token_id.address(), &reward_token_id.address(), &nft_contract_id);

        (env, ls_contract_id, nft_contract_id, admin, alice, bob, reward_token_id.address())
    }

    #[test]
    fn test_stake_and_mint_nft() {
        let (env, ls_id, nft_id, admin, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);
        let nft_client = nft_metadata::NftMetadataContractClient::new(&env, &nft_id);

        let token_id = client.stake(&alice, &500_000, &3600);
        
        assert_eq!(token_id, 1);
        assert_eq!(nft_client.owner_of(&token_id), alice);
        
        let info = client.get_stake_info(&token_id);
        assert_eq!(info.amount, 500_000);
    }
    
    #[test]
    fn test_transfer_and_claim() {
        let (env, ls_id, nft_id, admin, alice, bob, reward_token) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);
        let nft_client = nft_metadata::NftMetadataContractClient::new(&env, &nft_id);

        let token_id = client.stake(&alice, &500_000, &3600);
        
        // Admin deposits rewards
        client.deposit_rewards(&admin, &1_000);
        
        // Alice transfers NFT to Bob
        nft_client.transfer(&alice, &bob, &token_id);
        
        // Bob claims the rewards!
        let claimed = client.claim(&bob, &token_id);
        assert_eq!(claimed, 1_000);
        
        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&bob), 1_000);
    }
    
    #[test]
    #[should_panic(expected = "stake is locked")]
    fn test_unstake_locked() {
        let (env, ls_id, _, _, alice, _, _) = setup();
        let client = LiquidStakingClient::new(&env, &ls_id);

        let token_id = client.stake(&alice, &500_000, &3600);
        
        // Should panic because 3600 seconds haven't passed
        client.unstake(&alice, &token_id);
    }
}
