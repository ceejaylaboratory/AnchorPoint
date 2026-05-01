#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal};

#[contracttype]
pub enum DataKey {
    Admin,
    AmmPool,
    RewardToken,
    RewardRate, // Tokens per ledger
    LastUpdateLedger,
    RewardPerShareStored,
    UserRewardPerSharePaid(Address),
    Rewards(Address),
}

#[contract]
pub struct YieldFarmingDistributor;

#[contractimpl]
impl YieldFarmingDistributor {
    pub fn initialize(
        env: Env,
        admin: Address,
        amm_pool: Address,
        reward_token: Address,
        reward_rate: i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AmmPool, &amm_pool);
        env.storage()
            .instance()
            .set(&DataKey::RewardToken, &reward_token);
        env.storage()
            .instance()
            .set(&DataKey::RewardRate, &reward_rate);
        env.storage()
            .instance()
            .set(&DataKey::LastUpdateLedger, &env.ledger().sequence());
        env.storage()
            .instance()
            .set(&DataKey::RewardPerShareStored, &0i128);
    }

    pub fn set_reward_rate(env: Env, rate: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        Self::_update_global_reward(&env);
        env.storage().instance().set(&DataKey::RewardRate, &rate);
    }

    pub fn claim_rewards(env: Env, user: Address) -> i128 {
        user.require_auth();
        Self::_update_user_reward(&env, &user);

        let reward: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user.clone()))
            .unwrap_or(0);
        if reward > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::Rewards(user.clone()), &0i128);
            let reward_token: Address =
                env.storage().instance().get(&DataKey::RewardToken).unwrap();
            env.invoke_contract::<()>(
                &reward_token,
                &symbol_short!("transfer"),
                soroban_sdk::vec![
                    &env,
                    env.current_contract_address().to_val(),
                    user.to_val(),
                    reward.into_val(&env)
                ],
            );
        }
        reward
    }

    // View function to check pending rewards
    pub fn pending_rewards(env: Env, user: Address) -> i128 {
        let amm_pool: Address = env.storage().instance().get(&DataKey::AmmPool).unwrap();
        let total_shares: i128 = env.invoke_contract(
            &amm_pool,
            &soroban_sdk::Symbol::new(&env, "get_total_shares"),
            soroban_sdk::vec![&env],
        );
        let user_shares: i128 = env.invoke_contract(
            &amm_pool,
            &soroban_sdk::Symbol::new(&env, "get_shares"),
            soroban_sdk::vec![&env, user.to_val()],
        );

        let last_update: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LastUpdateLedger)
            .unwrap();
        let current_ledger = env.ledger().sequence();
        let reward_rate: i128 = env.storage().instance().get(&DataKey::RewardRate).unwrap();

        let mut reward_per_share: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPerShareStored)
            .unwrap_or(0);

        if current_ledger > last_update && total_shares > 0 {
            let ledgers_elapsed = (current_ledger - last_update) as i128;
            reward_per_share = reward_per_share.checked_add(
                ledgers_elapsed
                    .checked_mul(reward_rate).expect("reward overflow")
                    .checked_mul(1_000_000_000_000_000_000).expect("reward overflow")
                    / total_shares
            ).expect("reward overflow");
            reward_per_share +=
                (ledgers_elapsed * reward_rate * 1_000_000_000_000_000_000) / total_shares;
        }

        let user_paid: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardPerSharePaid(user.clone()))
            .unwrap_or(0);
        let rewards_accrued: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user.clone()))
            .unwrap_or(0);

        rewards_accrued.checked_add(
            user_shares.checked_mul(reward_per_share - user_paid).expect("reward overflow") / 1_000_000_000_000_000_000
        ).expect("reward overflow")
    }

    fn _update_global_reward(env: &Env) {
        let amm_pool: Address = env.storage().instance().get(&DataKey::AmmPool).unwrap();
        let total_shares: i128 = env.invoke_contract(
            &amm_pool,
            &soroban_sdk::Symbol::new(&env, "get_total_shares"),
            soroban_sdk::vec![env],
        );
        let last_update: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LastUpdateLedger)
            .unwrap();
        let current_ledger = env.ledger().sequence();

        if current_ledger > last_update {
            if total_shares > 0 {
                let reward_rate: i128 = env.storage().instance().get(&DataKey::RewardRate).unwrap();
                let ledgers_elapsed = (current_ledger - last_update) as i128;
                let mut stored: i128 = env.storage().instance().get(&DataKey::RewardPerShareStored).unwrap_or(0);
                stored = stored.checked_add(
                    ledgers_elapsed
                        .checked_mul(reward_rate).expect("reward overflow")
                        .checked_mul(1_000_000_000_000_000_000).expect("reward overflow")
                        / total_shares
                ).expect("reward overflow");
                env.storage().instance().set(&DataKey::RewardPerShareStored, &stored);
                let mut stored: i128 = env
                    .storage()
                    .instance()
                    .get(&DataKey::RewardPerShareStored)
                    .unwrap_or(0);
                stored +=
                    (ledgers_elapsed * reward_rate * 1_000_000_000_000_000_000) / total_shares;
                env.storage()
                    .instance()
                    .set(&DataKey::RewardPerShareStored, &stored);
            }
            env.storage()
                .instance()
                .set(&DataKey::LastUpdateLedger, &current_ledger);
        }
    }

    fn _update_user_reward(env: &Env, user: &Address) {
        Self::_update_global_reward(env);

        let stored: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPerShareStored)
            .unwrap_or(0);
        let user_paid: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardPerSharePaid(user.clone()))
            .unwrap_or(0);

        let amm_pool: Address = env.storage().instance().get(&DataKey::AmmPool).unwrap();
        let user_shares: i128 = env.invoke_contract(&amm_pool, &soroban_sdk::Symbol::new(&env, "get_shares"), soroban_sdk::vec![env, user.to_val()]);
        
        let earned = user_shares.checked_mul(stored - user_paid).expect("reward overflow") / 1_000_000_000_000_000_000;
        if earned > 0 {
            let prev: i128 = env.storage().persistent().get(&DataKey::Rewards(user.clone())).unwrap_or(0);
            env.storage().persistent().set(&DataKey::Rewards(user.clone()), &prev.checked_add(earned).expect("reward overflow"));
        let user_shares: i128 = env.invoke_contract(
            &amm_pool,
            &soroban_sdk::Symbol::new(&env, "get_shares"),
            soroban_sdk::vec![env, user.to_val()],
        );

        let earned = (user_shares * (stored - user_paid)) / 1_000_000_000_000_000_000;
        if earned > 0 {
            let prev: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Rewards(user.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::Rewards(user.clone()), &(prev + earned));
        }
        env.storage()
            .persistent()
            .set(&DataKey::UserRewardPerSharePaid(user.clone()), &stored);
    }
}
