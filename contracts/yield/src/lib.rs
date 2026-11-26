//! Yield Distribution & Auto-Compounding ERC-4626 Strategy Vault
//!
//! Features:
//! 1. Reward-per-token accumulator pattern for O(1) reward calculation per user.
//! 2. ERC-4626 Auto-Compounding Strategy Vault:
//!    - Tracks vault share supply and user share balances.
//!    - Harvests accrued yield from underlying staking pools or direct accrual.
//!    - Deducts a configurable performance fee (default 2%) sent to revenue distributor,
//!      and a caller bounty (default 0.5%) sent to the automation caller.
//!    - Reinvests remaining net yield into the principal pool, causing share price
//!      to increase monotonically over compounding cycles.

#![no_std]

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, IntoVal,
};

// Fixed-point precision: 1e18
const PRECISION: i128 = 1_000_000_000_000_000_000;
// Basis points denominator: 10,000 (100% = 10,000 bps)
const BPS_DENOMINATOR: i128 = 10_000;
// Default performance fee: 2% (200 bps)
const DEFAULT_PERFORMANCE_FEE_BPS: u32 = 200;
// Default caller bounty: 0.5% (50 bps)
const DEFAULT_CALLER_BOUNTY_BPS: u32 = 50;

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Address of the staking / underlying asset token
    StakeToken,
    /// Address of the reward token
    RewardToken,
    /// Contract admin
    Admin,
    /// Total tokens staked across all users in classical staking
    TotalStaked,
    /// Global accumulated reward per staked token (scaled by PRECISION)
    RewardPerTokenStored,
    /// Per-user staked balance in classical staking
    Stake(Address),
    /// Snapshot of RewardPerTokenStored at the last time a user interacted
    UserRewardPerTokenPaid(Address),
    /// Accrued but unclaimed rewards for a user
    Rewards(Address),
    /// Total vault shares outstanding (ERC-4626)
    VaultTotalShares,
    /// Per-user vault shares balance (ERC-4626)
    VaultShares(Address),
    /// Total principal assets managed by the vault (ERC-4626)
    VaultTotalAssets,
    /// Address of the revenue distributor receiving performance fees
    RevenueDistributor,
    /// Address of the underlying staking pool for harvesting yield
    StakingPool,
    /// Performance fee in basis points (e.g. 200 = 2%)
    PerformanceFeeBps,
    /// Caller bounty in basis points (e.g. 50 = 0.5%)
    CallerBountyBps,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct YieldDistribution;

#[contractimpl]
impl YieldDistribution {
    pub fn set_security_registry(env: Env, registry: Address) {
        if env.storage().instance().has(&symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage()
            .instance()
            .set(&symbol_short!("sec_reg"), &registry);
        env.events().publish((symbol_short!("sec_reg"),), registry);
    }

    // ── Admin / Initialisation ────────────────────────────────────────────

    /// Initialise the contract once.
    pub fn initialize(env: Env, admin: Address, stake_token: Address, reward_token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::StakeToken, &stake_token);
        env.storage()
            .instance()
            .set(&DataKey::RewardToken, &reward_token);
        env.storage().instance().set(&DataKey::TotalStaked, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::RewardPerTokenStored, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::VaultTotalShares, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::VaultTotalAssets, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::PerformanceFeeBps, &DEFAULT_PERFORMANCE_FEE_BPS);
        env.storage()
            .instance()
            .set(&DataKey::CallerBountyBps, &DEFAULT_CALLER_BOUNTY_BPS);

        env.events()
            .publish((symbol_short!("init"),), (admin, stake_token, reward_token));
    }

    // ── Vault Configuration ───────────────────────────────────────────────

    /// Configure the revenue distributor contract that receives harvest performance fees.
    pub fn set_revenue_distributor(env: Env, admin: Address, distributor: Address) {
        Self::_require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&DataKey::RevenueDistributor, &distributor);
        env.events()
            .publish((symbol_short!("rev_dist"), admin), distributor);
    }

    /// Configure the underlying staking pool from which yield is accrued and harvested.
    pub fn set_staking_pool(env: Env, admin: Address, pool: Address) {
        Self::_require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::StakingPool, &pool);
        env.events()
            .publish((symbol_short!("stk_pool"), admin), pool);
    }

    /// Update harvest fees (admin only).
    /// Both fees are specified in basis points (100 bps = 1%).
    pub fn set_fees(env: Env, admin: Address, performance_fee_bps: u32, caller_bounty_bps: u32) {
        Self::_require_admin(&env, &admin);
        assert!(
            performance_fee_bps as i128 + caller_bounty_bps as i128 <= BPS_DENOMINATOR,
            "fees exceed 100%"
        );
        env.storage()
            .instance()
            .set(&DataKey::PerformanceFeeBps, &performance_fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::CallerBountyBps, &caller_bounty_bps);
        env.events().publish(
            (symbol_short!("fees_set"), admin),
            (performance_fee_bps, caller_bounty_bps),
        );
    }

    /// Get current performance fee and caller bounty in basis points.
    pub fn get_fees(env: Env) -> (u32, u32) {
        Self::_get_fees(&env)
    }

    /// Returns configured revenue distributor if any.
    pub fn get_revenue_distributor(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::RevenueDistributor)
    }

    /// Returns configured underlying staking pool if any.
    pub fn get_staking_pool(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::StakingPool)
    }

    // ── ERC-4626 Auto-Compounding Vault ───────────────────────────────────

    /// Total assets held / managed by the vault.
    pub fn total_assets(env: Env) -> i128 {
        Self::_total_assets(&env)
    }

    /// Total vault shares outstanding.
    pub fn total_shares(env: Env) -> i128 {
        Self::_total_shares(&env)
    }

    /// Shares balance of a specific user.
    pub fn shares_of(env: Env, user: Address) -> i128 {
        Self::_user_shares(&env, &user)
    }

    /// Alias for total vault shares.
    pub fn vault_total_shares(env: Env) -> i128 {
        Self::_total_shares(&env)
    }

    /// Alias for user vault shares.
    pub fn vault_shares(env: Env, user: Address) -> i128 {
        Self::_user_shares(&env, &user)
    }

    /// Convert assets to equivalent vault shares at current exchange rate.
    pub fn convert_to_shares(env: Env, assets: i128) -> i128 {
        if assets <= 0 {
            return 0;
        }
        let total_shares = Self::_total_shares(&env);
        let total_assets = Self::_total_assets(&env);
        if total_shares == 0 || total_assets == 0 {
            assets
        } else {
            assets
                .checked_mul(total_shares)
                .expect("share convert overflow")
                / total_assets
        }
    }

    /// Convert shares to equivalent underlying assets at current exchange rate.
    pub fn convert_to_assets(env: Env, shares: i128) -> i128 {
        if shares <= 0 {
            return 0;
        }
        let total_shares = Self::_total_shares(&env);
        let total_assets = Self::_total_assets(&env);
        if total_shares == 0 {
            shares
        } else {
            shares
                .checked_mul(total_assets)
                .expect("asset convert overflow")
                / total_shares
        }
    }

    /// Current price of 1 share in underlying assets, scaled by PRECISION (1e18).
    /// Increases monotonically as yield is compounded.
    pub fn share_price(env: Env) -> i128 {
        let total_shares = Self::_total_shares(&env);
        let total_assets = Self::_total_assets(&env);
        if total_shares == 0 || total_assets == 0 {
            PRECISION
        } else {
            total_assets.checked_mul(PRECISION).expect("price overflow") / total_shares
        }
    }

    /// Deposit assets into the vault, minting proportional vault shares to `user`.
    /// First depositor receives shares at 1:1 ratio. Subsequent depositors receive
    /// shares proportional to the current share price.
    pub fn deposit(env: Env, user: Address, assets: i128) -> i128 {
        Self::_check_security_registry(&env);
        user.require_auth();
        assert!(assets > 0, "amount must be positive");

        let total_shares = Self::_total_shares(&env);
        let total_assets = Self::_total_assets(&env);

        let shares_to_mint = if total_shares == 0 || total_assets == 0 {
            assets
        } else {
            assets
                .checked_mul(total_shares)
                .expect("share mint overflow")
                / total_assets
        };
        assert!(shares_to_mint > 0, "deposit too small to mint shares");

        let prev_user_shares = Self::_user_shares(&env, &user);
        Self::_set_user_shares(
            &env,
            &user,
            prev_user_shares
                .checked_add(shares_to_mint)
                .expect("share overflow"),
        );
        Self::_set_total_shares(
            &env,
            total_shares
                .checked_add(shares_to_mint)
                .expect("total share overflow"),
        );
        Self::_set_total_assets(
            &env,
            total_assets
                .checked_add(assets)
                .expect("total assets overflow"),
        );

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &user,
            &env.current_contract_address(),
            &assets,
        );

        // If an underlying staking pool is configured, stake the assets into it
        if let Some(pool) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::StakingPool)
        {
            env.authorize_as_current_contract(soroban_sdk::vec![
                &env,
                InvokerContractAuthEntry::Contract(SubContractInvocation {
                    context: ContractContext {
                        contract: stake_token.clone(),
                        fn_name: symbol_short!("transfer"),
                        args: (env.current_contract_address(), pool.clone(), assets).into_val(&env),
                    },
                    sub_invocations: soroban_sdk::vec![&env],
                }),
            ]);
            env.invoke_contract::<()>(
                &pool,
                &soroban_sdk::Symbol::new(&env, "stake"),
                soroban_sdk::vec![
                    &env,
                    env.current_contract_address().to_val(),
                    assets.into_val(&env)
                ],
            );
        }

        env.events()
            .publish((symbol_short!("deposit"), user), (assets, shares_to_mint));

        shares_to_mint
    }

    /// Alias for deposit.
    pub fn vault_deposit(env: Env, user: Address, amount: i128) -> i128 {
        Self::deposit(env, user, amount)
    }

    /// Mint exact `shares` to `user` by pulling necessary assets.
    pub fn mint(env: Env, user: Address, shares: i128) -> i128 {
        Self::_check_security_registry(&env);
        user.require_auth();
        assert!(shares > 0, "shares must be positive");

        let total_shares = Self::_total_shares(&env);
        let total_assets = Self::_total_assets(&env);

        let assets_needed = if total_shares == 0 || total_assets == 0 {
            shares
        } else {
            // Round up to ensure vault is never shortchanged
            let numerator = shares.checked_mul(total_assets).expect("mint overflow");
            (numerator + total_shares - 1) / total_shares
        };

        let prev_user_shares = Self::_user_shares(&env, &user);
        Self::_set_user_shares(
            &env,
            &user,
            prev_user_shares
                .checked_add(shares)
                .expect("share overflow"),
        );
        Self::_set_total_shares(
            &env,
            total_shares
                .checked_add(shares)
                .expect("total share overflow"),
        );
        Self::_set_total_assets(
            &env,
            total_assets
                .checked_add(assets_needed)
                .expect("total assets overflow"),
        );

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &user,
            &env.current_contract_address(),
            &assets_needed,
        );

        if let Some(pool) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::StakingPool)
        {
            env.authorize_as_current_contract(soroban_sdk::vec![
                &env,
                InvokerContractAuthEntry::Contract(SubContractInvocation {
                    context: ContractContext {
                        contract: stake_token.clone(),
                        fn_name: symbol_short!("transfer"),
                        args: (env.current_contract_address(), pool.clone(), assets_needed)
                            .into_val(&env),
                    },
                    sub_invocations: soroban_sdk::vec![&env],
                }),
            ]);
            env.invoke_contract::<()>(
                &pool,
                &soroban_sdk::Symbol::new(&env, "stake"),
                soroban_sdk::vec![
                    &env,
                    env.current_contract_address().to_val(),
                    assets_needed.into_val(&env)
                ],
            );
        }

        env.events()
            .publish((symbol_short!("mint"), user), (shares, assets_needed));

        assets_needed
    }

    /// Redeem `shares` of vault shares, returning proportional underlying assets.
    pub fn redeem(env: Env, user: Address, shares: i128) -> i128 {
        Self::_check_security_registry(&env);
        user.require_auth();
        assert!(shares > 0, "shares must be positive");

        let total_shares = Self::_total_shares(&env);
        assert!(total_shares > 0, "no shares outstanding");

        let user_shares = Self::_user_shares(&env, &user);
        assert!(user_shares >= shares, "insufficient shares");

        let total_assets = Self::_total_assets(&env);
        let assets_to_return =
            shares.checked_mul(total_assets).expect("redeem overflow") / total_shares;
        assert!(assets_to_return > 0, "shares resolve to zero assets");

        Self::_set_user_shares(
            &env,
            &user,
            user_shares.checked_sub(shares).expect("share underflow"),
        );
        Self::_set_total_shares(
            &env,
            total_shares.checked_sub(shares).expect("total underflow"),
        );
        Self::_set_total_assets(
            &env,
            total_assets
                .checked_sub(assets_to_return)
                .expect("assets underflow"),
        );

        // If underlying staking pool is configured, unstake from pool
        if let Some(pool) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::StakingPool)
        {
            env.invoke_contract::<()>(
                &pool,
                &soroban_sdk::Symbol::new(&env, "unstake"),
                soroban_sdk::vec![
                    &env,
                    env.current_contract_address().to_val(),
                    assets_to_return.into_val(&env)
                ],
            );
        }

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &env.current_contract_address(),
            &user,
            &assets_to_return,
        );

        env.events()
            .publish((symbol_short!("redeem"), user), (shares, assets_to_return));

        assets_to_return
    }

    /// Withdraw exact `assets` from vault by burning proportional shares.
    pub fn withdraw(env: Env, user: Address, assets: i128) -> i128 {
        Self::_check_security_registry(&env);
        user.require_auth();
        assert!(assets > 0, "amount must be positive");

        let total_shares = Self::_total_shares(&env);
        let total_assets = Self::_total_assets(&env);
        assert!(total_assets > 0 && total_shares > 0, "vault is empty");

        // Round up shares to burn to protect remaining vault depositors
        let numerator = assets.checked_mul(total_shares).expect("withdraw overflow");
        let shares_to_burn = (numerator + total_assets - 1) / total_assets;

        let user_shares = Self::_user_shares(&env, &user);
        assert!(user_shares >= shares_to_burn, "insufficient shares");

        Self::_set_user_shares(
            &env,
            &user,
            user_shares
                .checked_sub(shares_to_burn)
                .expect("share underflow"),
        );
        Self::_set_total_shares(
            &env,
            total_shares
                .checked_sub(shares_to_burn)
                .expect("total underflow"),
        );
        Self::_set_total_assets(
            &env,
            total_assets.checked_sub(assets).expect("assets underflow"),
        );

        if let Some(pool) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::StakingPool)
        {
            env.invoke_contract::<()>(
                &pool,
                &soroban_sdk::Symbol::new(&env, "unstake"),
                soroban_sdk::vec![
                    &env,
                    env.current_contract_address().to_val(),
                    assets.into_val(&env)
                ],
            );
        }

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &env.current_contract_address(),
            &user,
            &assets,
        );

        env.events()
            .publish((symbol_short!("withdraw"), user), (assets, shares_to_burn));

        shares_to_burn
    }

    /// Alias for redeem.
    pub fn vault_withdraw(env: Env, user: Address, shares: i128) -> i128 {
        Self::redeem(env, user, shares)
    }

    /// Helper to deposit unharvested yield tokens directly into the vault
    /// (e.g. from tests or external protocol revenue).
    pub fn deposit_yield(env: Env, from: Address, amount: i128) {
        Self::_check_security_registry(&env);
        from.require_auth();
        assert!(amount > 0, "amount must be positive");

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        env.events()
            .publish((symbol_short!("dep_yield"), from), amount);
    }

    /// Harvest accrued yield from the underlying staking pool (or unharvested balance),
    /// deducts performance fee and caller bounty, and reinvests the net yield into
    /// the principal pool.
    ///
    /// This causes the share price to increase monotonically over compounding cycles.
    /// External automation callers / bots are incentivized by the caller bounty.
    ///
    /// Returns the net yield compounded into the vault principal.
    pub fn harvest(env: Env, caller: Address) -> i128 {
        Self::_check_security_registry(&env);
        caller.require_auth();

        let vault_addr = env.current_contract_address();
        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        let stake_client = token::Client::new(&env, &stake_token);

        let mut gross_yield: i128 = 0;

        // 1. Collect accrued yield from underlying staking pool if configured
        if let Some(pool) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::StakingPool)
        {
            let reward_token: Address = env
                .storage()
                .instance()
                .get(&DataKey::RewardToken)
                .unwrap_or_else(|| stake_token.clone());
            let claimed: i128 = env.invoke_contract(
                &pool,
                &soroban_sdk::Symbol::new(&env, "claim"),
                soroban_sdk::vec![&env, vault_addr.to_val(), reward_token.to_val()],
            );
            gross_yield = gross_yield.checked_add(claimed).expect("yield overflow");
        }

        // 2. Collect any unharvested yield tokens present in the vault contract
        let current_balance = stake_client.balance(&vault_addr);
        let total_assets = Self::_total_assets(&env);
        let balance_excess = current_balance
            .checked_sub(
                total_assets
                    .checked_add(gross_yield)
                    .unwrap_or(total_assets),
            )
            .unwrap_or(0);
        if balance_excess > 0 {
            gross_yield = gross_yield
                .checked_add(balance_excess)
                .expect("yield overflow");
        }

        assert!(gross_yield > 0, "no yield to harvest");

        // 3. Deduct configurable performance fee and caller bounty
        let (perf_fee_bps, caller_bounty_bps) = Self::_get_fees(&env);
        let perf_fee = gross_yield
            .checked_mul(perf_fee_bps as i128)
            .expect("perf fee overflow")
            / BPS_DENOMINATOR;
        let caller_bounty = gross_yield
            .checked_mul(caller_bounty_bps as i128)
            .expect("caller bounty overflow")
            / BPS_DENOMINATOR;
        let net_yield = gross_yield
            .checked_sub(perf_fee)
            .expect("underflow")
            .checked_sub(caller_bounty)
            .expect("underflow");

        // 4. Send performance fee to revenue distributor
        if perf_fee > 0 {
            let distributor = env
                .storage()
                .instance()
                .get::<_, Address>(&DataKey::RevenueDistributor)
                .unwrap_or_else(|| env.storage().instance().get(&DataKey::Admin).unwrap());
            stake_client.transfer(&vault_addr, &distributor, &perf_fee);
        }

        // 5. Send caller bounty to caller
        if caller_bounty > 0 {
            stake_client.transfer(&vault_addr, &caller, &caller_bounty);
        }

        // 6. Reinvest remaining net yield into principal pool
        let new_total_assets = total_assets
            .checked_add(net_yield)
            .expect("assets overflow");
        Self::_set_total_assets(&env, new_total_assets);

        // If underlying staking pool is configured, stake net yield back into it
        if let Some(pool) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::StakingPool)
        {
            env.authorize_as_current_contract(soroban_sdk::vec![
                &env,
                InvokerContractAuthEntry::Contract(SubContractInvocation {
                    context: ContractContext {
                        contract: stake_token.clone(),
                        fn_name: symbol_short!("transfer"),
                        args: (vault_addr.clone(), pool.clone(), net_yield).into_val(&env),
                    },
                    sub_invocations: soroban_sdk::vec![&env],
                }),
            ]);
            env.invoke_contract::<()>(
                &pool,
                &soroban_sdk::Symbol::new(&env, "stake"),
                soroban_sdk::vec![&env, vault_addr.to_val(), net_yield.into_val(&env)],
            );
        }

        env.events().publish(
            (symbol_short!("harvest"), caller),
            (gross_yield, perf_fee, caller_bounty, net_yield),
        );

        net_yield
    }

    // ── Classical Staking & Reward Distribution (Backwards Compatible) ─────

    /// Deposit `amount` of reward tokens into the contract for distribution.
    /// Calling this increases `reward_per_token_stored` proportionally.
    pub fn deposit_rewards(env: Env, from: Address, amount: i128) {
        Self::_check_security_registry(&env);
        from.require_auth();
        assert!(amount > 0, "amount must be positive");

        let total_staked: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);

        if total_staked > 0 {
            let mut rpt: i128 = env
                .storage()
                .instance()
                .get(&DataKey::RewardPerTokenStored)
                .unwrap_or(0);
            rpt = rpt
                .checked_add(amount.checked_mul(PRECISION).expect("rpt overflow") / total_staked)
                .expect("rpt overflow");
            env.storage()
                .instance()
                .set(&DataKey::RewardPerTokenStored, &rpt);
        }

        let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
        token::Client::new(&env, &reward_token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        env.events()
            .publish((symbol_short!("dep_rwd"),), (from, amount));
    }

    /// Stake `amount` of the staking token.
    pub fn stake(env: Env, user: Address, amount: i128) {
        Self::_check_security_registry(&env);
        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        Self::_update_reward(&env, &user);

        let prev: i128 = Self::_stake_of(&env, &user);
        env.storage().persistent().set(
            &DataKey::Stake(user.clone()),
            &prev.checked_add(amount).expect("stake overflow"),
        );

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalStaked,
            &total.checked_add(amount).expect("total staked overflow"),
        );

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &user,
            &env.current_contract_address(),
            &amount,
        );

        env.events()
            .publish((symbol_short!("staked"),), (user, amount));
    }

    /// Unstake `amount` of the staking token.
    pub fn unstake(env: Env, user: Address, amount: i128) {
        Self::_check_security_registry(&env);
        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        let prev = Self::_stake_of(&env, &user);
        assert!(prev >= amount, "insufficient stake");

        Self::_update_reward(&env, &user);

        env.storage().persistent().set(
            &DataKey::Stake(user.clone()),
            &prev.checked_sub(amount).expect("stake underflow"),
        );

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalStaked,
            &total.checked_sub(amount).expect("total staked underflow"),
        );

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &env.current_contract_address(),
            &user,
            &amount,
        );

        env.events()
            .publish((symbol_short!("unstaked"),), (user, amount));
    }

    /// Claim all accrued rewards for `user`.
    pub fn claim(env: Env, user: Address) -> i128 {
        Self::_check_security_registry(&env);
        user.require_auth();
        Self::_update_reward(&env, &user);

        let reward: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user.clone()))
            .unwrap_or(0);

        if reward > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::Rewards(user.clone()), &0_i128);

            let reward_token: Address =
                env.storage().instance().get(&DataKey::RewardToken).unwrap();
            token::Client::new(&env, &reward_token).transfer(
                &env.current_contract_address(),
                &user,
                &reward,
            );
        }
        env.events()
            .publish((symbol_short!("claimed"),), (user, reward));

        reward
    }

    // ── Views ─────────────────────────────────────────────────────────────

    /// Returns the pending (unclaimed) reward for `user`. O(1).
    pub fn pending_rewards(env: Env, user: Address) -> i128 {
        let rpt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPerTokenStored)
            .unwrap_or(0);
        let user_rpt: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardPerTokenPaid(user.clone()))
            .unwrap_or(0);
        let stake = Self::_stake_of(&env, &user);
        let accrued: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user))
            .unwrap_or(0);

        accrued + stake.checked_mul(rpt - user_rpt).expect("rewards overflow") / PRECISION
    }

    pub fn total_staked(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0)
    }

    pub fn stake_of(env: Env, user: Address) -> i128 {
        Self::_stake_of(&env, &user)
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    fn _require_admin(env: &Env, admin: &Address) {
        admin.require_auth();
        let expected_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        assert_eq!(*admin, expected_admin, "unauthorized");
    }

    fn _check_security_registry(env: &Env) {
        if let Some(registry) = env
            .storage()
            .instance()
            .get::<_, Address>(&symbol_short!("sec_reg"))
        {
            let is_paused: bool = env.invoke_contract(
                &registry,
                &soroban_sdk::Symbol::new(env, "is_paused"),
                soroban_sdk::vec![env],
            );
            if is_paused {
                panic!("contract is paused");
            }
        }
    }

    fn _total_shares(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::VaultTotalShares)
            .unwrap_or(0)
    }

    fn _set_total_shares(env: &Env, shares: i128) {
        env.storage()
            .instance()
            .set(&DataKey::VaultTotalShares, &shares);
    }

    fn _total_assets(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::VaultTotalAssets)
            .unwrap_or(0)
    }

    fn _set_total_assets(env: &Env, assets: i128) {
        env.storage()
            .instance()
            .set(&DataKey::VaultTotalAssets, &assets);
    }

    fn _user_shares(env: &Env, user: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::VaultShares(user.clone()))
            .unwrap_or(0)
    }

    fn _set_user_shares(env: &Env, user: &Address, shares: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::VaultShares(user.clone()), &shares);
    }

    fn _get_fees(env: &Env) -> (u32, u32) {
        let perf_fee: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PerformanceFeeBps)
            .unwrap_or(DEFAULT_PERFORMANCE_FEE_BPS);
        let bounty: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CallerBountyBps)
            .unwrap_or(DEFAULT_CALLER_BOUNTY_BPS);
        (perf_fee, bounty)
    }

    fn _update_reward(env: &Env, user: &Address) {
        let rpt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPerTokenStored)
            .unwrap_or(0);

        let user_rpt: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardPerTokenPaid(user.clone()))
            .unwrap_or(0);

        let stake = Self::_stake_of(env, user);
        let earned = stake.checked_mul(rpt - user_rpt).expect("rewards overflow") / PRECISION;

        if earned > 0 {
            let prev: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Rewards(user.clone()))
                .unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::Rewards(user.clone()),
                &prev.checked_add(earned).expect("rewards overflow"),
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::UserRewardPerTokenPaid(user.clone()), &rpt);
    }

    fn _stake_of(env: &Env, user: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Stake(user.clone()))
            .unwrap_or(0)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl, symbol_short,
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env,
    };

    #[contract]
    pub struct MockRegistry;
    #[contractimpl]
    impl MockRegistry {
        pub fn is_paused(env: Env) -> bool {
            env.storage()
                .instance()
                .get(&symbol_short!("paused"))
                .unwrap_or(false)
        }
        pub fn set_paused(env: Env, paused: bool) {
            env.storage()
                .instance()
                .set(&symbol_short!("paused"), &paused);
        }
    }

    #[contract]
    pub struct MockStakingPool;
    #[contractimpl]
    impl MockStakingPool {
        pub fn stake(env: Env, user: Address, amount: i128) {
            user.require_auth();
            let token_addr: Address = env
                .storage()
                .instance()
                .get(&symbol_short!("token"))
                .unwrap();
            token::Client::new(&env, &token_addr).transfer(
                &user,
                &env.current_contract_address(),
                &amount,
            );
            let total: i128 = env
                .storage()
                .instance()
                .get(&symbol_short!("staked"))
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&symbol_short!("staked"), &(total + amount));
        }

        pub fn unstake(env: Env, user: Address, amount: i128) {
            user.require_auth();
            let total: i128 = env
                .storage()
                .instance()
                .get(&symbol_short!("staked"))
                .unwrap_or(0);
            assert!(total >= amount, "insufficient staked");
            env.storage()
                .instance()
                .set(&symbol_short!("staked"), &(total - amount));

            let token_addr: Address = env
                .storage()
                .instance()
                .get(&symbol_short!("token"))
                .unwrap();
            token::Client::new(&env, &token_addr).transfer(
                &env.current_contract_address(),
                &user,
                &amount,
            );
        }

        pub fn set_token(env: Env, token: Address) {
            env.storage()
                .instance()
                .set(&symbol_short!("token"), &token);
        }

        pub fn set_pending_reward(env: Env, amount: i128) {
            env.storage()
                .instance()
                .set(&symbol_short!("reward"), &amount);
        }

        pub fn claim(env: Env, user: Address, _reward_token: Address) -> i128 {
            let pending: i128 = env
                .storage()
                .instance()
                .get(&symbol_short!("reward"))
                .unwrap_or(0);
            if pending > 0 {
                env.storage()
                    .instance()
                    .set(&symbol_short!("reward"), &0_i128);
                let token_addr: Address = env
                    .storage()
                    .instance()
                    .get(&symbol_short!("token"))
                    .unwrap();
                token::Client::new(&env, &token_addr).transfer(
                    &env.current_contract_address(),
                    &user,
                    &pending,
                );
            }
            pending
        }
    }

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

        stake_sac.mint(&alice, &10_000_000);
        stake_sac.mint(&bob, &10_000_000);
        reward_sac.mint(&admin, &50_000_000);

        let contract_id = env.register(YieldDistribution, ());
        let client = YieldDistributionClient::new(&env, &contract_id);
        client.initialize(
            &admin,
            &stake_token_id.address(),
            &reward_token_id.address(),
        );

        (
            env,
            contract_id,
            admin,
            alice,
            bob,
            reward_token_id.address(),
            stake_token_id.address(),
        )
    }

    // ── Classical Staking Tests ───────────────────────────────────────────

    #[test]
    fn test_stake_and_claim() {
        let (env, contract_id, admin, alice, _bob, reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        client.stake(&alice, &500_000);
        assert_eq!(client.total_staked(), 500_000);

        client.deposit_rewards(&admin, &1_000);
        assert_eq!(client.pending_rewards(&alice), 1_000);

        let claimed = client.claim(&alice);
        assert_eq!(claimed, 1_000);
        assert_eq!(client.pending_rewards(&alice), 0);

        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 1_000);
    }

    #[test]
    fn test_proportional_split() {
        let (env, contract_id, admin, alice, bob, _, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        client.stake(&alice, &300_000);
        client.stake(&bob, &700_000);

        client.deposit_rewards(&admin, &1_000);

        assert_eq!(client.pending_rewards(&alice), 300);
        assert_eq!(client.pending_rewards(&bob), 700);
    }

    #[test]
    fn test_rewards_accrue_correctly_after_late_stake() {
        let (env, contract_id, admin, alice, bob, _, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        client.stake(&alice, &500_000);
        client.deposit_rewards(&admin, &1_000);

        client.stake(&bob, &500_000);
        client.deposit_rewards(&admin, &1_000);

        assert_eq!(client.pending_rewards(&alice), 1_500);
        assert_eq!(client.pending_rewards(&bob), 500);
    }

    #[test]
    fn test_unstake_settles_rewards() {
        let (env, contract_id, admin, alice, _bob, reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        client.stake(&alice, &500_000);
        client.deposit_rewards(&admin, &1_000);

        client.unstake(&alice, &500_000);
        assert_eq!(client.stake_of(&alice), 0);
        assert_eq!(client.pending_rewards(&alice), 1_000);

        client.claim(&alice);
        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 1_000);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_pause_deposit_rewards() {
        let (env, contract_id, admin, _alice, _bob, _, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        let registry_id = env.register(MockRegistry, ());
        let registry_client = MockRegistryClient::new(&env, &registry_id);
        registry_client.set_paused(&true);

        client.set_security_registry(&registry_id);
        client.deposit_rewards(&admin, &1_000);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_deposit_limit() {
        let (env, contract_id, _admin, alice, _bob, _, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        client.stake(&alice, &0);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_withdraw_limit_zero() {
        let (env, contract_id, _admin, alice, _bob, _, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        client.stake(&alice, &100);
        client.unstake(&alice, &0);
    }

    #[test]
    #[should_panic(expected = "insufficient stake")]
    fn test_withdraw_limit_insufficient() {
        let (env, contract_id, _admin, alice, _bob, _, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        client.stake(&alice, &100);
        client.unstake(&alice, &200);
    }

    #[test]
    fn test_contract_invariants() {
        let (env, contract_id, _admin, alice, bob, _reward_token, stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        let stake_client = TokenClient::new(&env, &stake_token);

        assert_eq!(client.total_staked(), 0);
        assert_eq!(stake_client.balance(&contract_id), 0);

        client.stake(&alice, &300_000);
        assert_eq!(client.total_staked(), 300_000);
        assert_eq!(stake_client.balance(&contract_id), 300_000);

        client.stake(&bob, &700_000);
        assert_eq!(client.total_staked(), 1_000_000);
        assert_eq!(stake_client.balance(&contract_id), 1_000_000);

        assert_eq!(client.total_staked(), stake_client.balance(&contract_id));

        client.unstake(&alice, &100_000);
        assert_eq!(client.total_staked(), 900_000);
        assert_eq!(stake_client.balance(&contract_id), 900_000);

        assert_eq!(
            client.stake_of(&alice) + client.stake_of(&bob),
            client.total_staked()
        );
    }

    #[test]
    fn test_compound_interest_formula_over_time() {
        let (env, contract_id, admin, alice, bob, reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        client.stake(&alice, &1_000_000);
        client.stake(&bob, &1_000_000);

        client.deposit_rewards(&admin, &10_000);

        assert_eq!(client.pending_rewards(&alice), 5_000);
        assert_eq!(client.pending_rewards(&bob), 5_000);

        let alice_claimed = client.claim(&alice);
        assert_eq!(alice_claimed, 5_000);

        client.deposit_rewards(&admin, &10_000);

        assert_eq!(client.pending_rewards(&alice), 5_000);
        // Bob accumulated 5,000 from first deposit + 5,000 from second = 10,000
        assert_eq!(client.pending_rewards(&bob), 10_000);

        let bob_claimed = client.claim(&bob);
        assert_eq!(bob_claimed, 10_000);

        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 5_000);
        assert_eq!(reward_client.balance(&bob), 10_000);
    }

    #[test]
    fn test_compound_interest_with_multiple_deposits() {
        let (env, contract_id, admin, alice, _bob, reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        client.stake(&alice, &500_000);

        client.deposit_rewards(&admin, &1_000);
        client.deposit_rewards(&admin, &1_000);
        client.deposit_rewards(&admin, &1_000);

        assert_eq!(client.pending_rewards(&alice), 3_000);

        let claimed = client.claim(&alice);
        assert_eq!(claimed, 3_000);

        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 3_000);
    }

    #[test]
    fn test_compound_interest_precision_over_time() {
        let (env, contract_id, admin, alice, bob, reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        client.stake(&alice, &1);
        client.stake(&bob, &999_999);

        client.deposit_rewards(&admin, &1_000_000);

        assert_eq!(client.pending_rewards(&alice), 1);
        assert_eq!(client.pending_rewards(&bob), 999_999);

        assert_eq!(client.claim(&alice), 1);

        client.deposit_rewards(&admin, &1_000_000);

        assert_eq!(client.pending_rewards(&alice), 1);
        // Bob accumulated 999_999 from deposit 1 + 999_999 from deposit 2 = 1_999_998
        assert_eq!(client.pending_rewards(&bob), 1_999_998);

        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 1);
    }

    #[test]
    fn test_compound_interest_accrual_after_unstake() {
        let (env, contract_id, admin, alice, bob, reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        client.stake(&alice, &500_000);
        client.stake(&bob, &500_000);

        client.deposit_rewards(&admin, &10_000);

        assert_eq!(client.pending_rewards(&alice), 5_000);
        assert_eq!(client.pending_rewards(&bob), 5_000);

        client.unstake(&alice, &500_000);

        assert_eq!(client.pending_rewards(&alice), 5_000);
        assert_eq!(client.pending_rewards(&bob), 5_000);

        client.deposit_rewards(&admin, &10_000);

        assert_eq!(client.pending_rewards(&bob), 15_000);
        assert_eq!(client.pending_rewards(&alice), 5_000);

        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 0);
        assert_eq!(reward_client.balance(&bob), 0);
    }

    // ── ERC-4626 Vault & Auto-Compounding Tests ───────────────────────────

    #[test]
    fn test_vault_first_deposit_mints_1_to_1() {
        let (env, contract_id, _admin, alice, _bob, _reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        let shares = client.deposit(&alice, &100_000);
        assert_eq!(shares, 100_000);
        assert_eq!(client.total_shares(), 100_000);
        assert_eq!(client.total_assets(), 100_000);
        assert_eq!(client.shares_of(&alice), 100_000);
        assert_eq!(client.share_price(), PRECISION); // 1.0 (1e18)
    }

    #[test]
    fn test_vault_share_pricing_calculation() {
        let (env, contract_id, _admin, alice, bob, _reward_token, stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        let stake_sac = StellarAssetClient::new(&env, &stake_token);

        // Initial deposit
        client.deposit(&alice, &100_000);
        assert_eq!(client.share_price(), PRECISION);
        assert_eq!(client.convert_to_shares(&100_000), 100_000);
        assert_eq!(client.convert_to_assets(&100_000), 100_000);

        // Inject yield directly into vault to simulate compounding growth
        stake_sac.mint(&alice, &50_000);
        client.deposit_yield(&alice, &50_000);

        // Harvest yield with a bot caller
        let bot = Address::generate(&env);
        let net_yield = client.harvest(&bot);
        assert!(net_yield > 0);

        // Share price must now be strictly greater than 1.0 (PRECISION)
        let price_after_yield = client.share_price();
        assert!(price_after_yield > PRECISION);

        // Bob deposits 100_000 assets. Since share price > 1.0, Bob receives fewer shares than assets
        let bob_shares = client.deposit(&bob, &100_000);
        assert!(bob_shares < 100_000);
        assert_eq!(client.convert_to_shares(&100_000), bob_shares);
        assert_eq!(
            client.convert_to_assets(&bob_shares),
            bob_shares * client.total_assets() / client.total_shares()
        );
    }

    #[test]
    fn test_harvest_fee_distribution_math() {
        let (env, contract_id, admin, alice, _bob, _reward_token, stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        let stake_sac = StellarAssetClient::new(&env, &stake_token);
        let stake_client = TokenClient::new(&env, &stake_token);

        let rev_distributor = Address::generate(&env);
        let bot = Address::generate(&env);

        client.set_revenue_distributor(&admin, &rev_distributor);
        // Default fees: 2% performance fee (200 bps) + 0.5% caller bounty (50 bps)
        assert_eq!(client.get_fees(), (200, 50));

        // Alice deposits 1_000_000 into vault
        client.deposit(&alice, &1_000_000);

        // Accrue 10_000 yield
        let yield_amount = 10_000_i128;
        stake_sac.mint(&admin, &yield_amount);
        client.deposit_yield(&admin, &yield_amount);

        // Harvest
        let net_compounded = client.harvest(&bot);

        // Expected math:
        // Perf fee: 10,000 * 200 / 10,000 = 200
        // Caller bounty: 10,000 * 50 / 10,000 = 50
        // Net compounded: 10,000 - 200 - 50 = 9,750
        let expected_perf_fee = 200_i128;
        let expected_bounty = 50_i128;
        let expected_net = 9_750_i128;

        assert_eq!(stake_client.balance(&rev_distributor), expected_perf_fee);
        assert_eq!(stake_client.balance(&bot), expected_bounty);
        assert_eq!(net_compounded, expected_net);

        // Total assets now = initial deposit + net compounded yield
        assert_eq!(client.total_assets(), 1_000_000 + expected_net);
    }

    #[test]
    fn test_share_price_increases_monotonically_over_compounding_cycles() {
        let (env, contract_id, admin, alice, _bob, _reward_token, stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        let stake_sac = StellarAssetClient::new(&env, &stake_token);
        let bot = Address::generate(&env);

        client.deposit(&alice, &1_000_000);
        let price_0 = client.share_price();
        assert_eq!(price_0, PRECISION);

        // Cycle 1: 10,000 yield
        stake_sac.mint(&admin, &10_000);
        client.deposit_yield(&admin, &10_000);
        client.harvest(&bot);
        let price_1 = client.share_price();
        assert!(
            price_1 > price_0,
            "price must increase monotonically after cycle 1"
        );

        // Cycle 2: 20,000 yield
        stake_sac.mint(&admin, &20_000);
        client.deposit_yield(&admin, &20_000);
        client.harvest(&bot);
        let price_2 = client.share_price();
        assert!(
            price_2 > price_1,
            "price must increase monotonically after cycle 2"
        );

        // Cycle 3: 50,000 yield
        stake_sac.mint(&admin, &50_000);
        client.deposit_yield(&admin, &50_000);
        client.harvest(&bot);
        let price_3 = client.share_price();
        assert!(
            price_3 > price_2,
            "price must increase monotonically after cycle 3"
        );
    }

    #[test]
    fn test_deposit_harvest_compounding_and_withdrawal_round_trip() {
        let (env, contract_id, admin, alice, bob, _reward_token, stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        let stake_sac = StellarAssetClient::new(&env, &stake_token);
        let stake_client = TokenClient::new(&env, &stake_token);

        let rev_distributor = Address::generate(&env);
        let bot = Address::generate(&env);
        client.set_revenue_distributor(&admin, &rev_distributor);

        // Alice deposits 100_000 assets -> gets 100_000 shares
        let alice_initial_balance = stake_client.balance(&alice);
        client.deposit(&alice, &100_000);
        assert_eq!(client.shares_of(&alice), 100_000);

        // Yield of 10,000 is accrued and harvested
        stake_sac.mint(&admin, &10_000);
        client.deposit_yield(&admin, &10_000);
        client.harvest(&bot);

        // Net yield = 9,750 (200 perf fee, 50 bounty). Total assets = 109,750
        assert_eq!(client.total_assets(), 109_750);

        // Bob deposits 109,750 assets -> gets exactly 100_000 shares!
        let bob_initial_balance = stake_client.balance(&bob);
        let bob_shares = client.deposit(&bob, &109_750);
        assert_eq!(bob_shares, 100_000);
        assert_eq!(client.total_shares(), 200_000);
        assert_eq!(client.total_assets(), 219_500);

        // Another yield harvest of 20,000 (fee: 400, bounty: 100, net: 19,500)
        stake_sac.mint(&admin, &20_000);
        client.deposit_yield(&admin, &20_000);
        client.harvest(&bot);

        // Total assets = 219,500 + 19,500 = 239,000
        assert_eq!(client.total_assets(), 239_000);
        assert_eq!(client.total_shares(), 200_000);

        // Alice redeems all 100_000 shares (50% of the vault)
        let alice_redeemed = client.redeem(&alice, &100_000);
        assert_eq!(alice_redeemed, 119_500); // 239,000 * 100,000 / 200,000
        assert_eq!(client.shares_of(&alice), 0);
        assert_eq!(
            stake_client.balance(&alice),
            alice_initial_balance - 100_000 + 119_500
        );

        // Bob redeems remaining 100_000 shares
        let bob_redeemed = client.redeem(&bob, &100_000);
        assert_eq!(bob_redeemed, 119_500);
        assert_eq!(client.shares_of(&bob), 0);
        assert_eq!(
            stake_client.balance(&bob),
            bob_initial_balance - 109_750 + 119_500
        );

        // Vault is fully empty
        assert_eq!(client.total_shares(), 0);
        assert_eq!(client.total_assets(), 0);
    }

    #[test]
    fn test_vault_with_underlying_staking_pool_round_trip() {
        let (env, contract_id, admin, alice, _bob, _reward_token, stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        let stake_sac = StellarAssetClient::new(&env, &stake_token);
        let stake_client = TokenClient::new(&env, &stake_token);

        let bot = Address::generate(&env);
        let rev_dist = Address::generate(&env);
        client.set_revenue_distributor(&admin, &rev_dist);

        // Deploy and initialize mock staking pool
        let pool_id = env.register(MockStakingPool, ());
        let pool_client = MockStakingPoolClient::new(&env, &pool_id);
        pool_client.set_token(&stake_token);

        // Configure vault to use mock staking pool
        client.set_staking_pool(&admin, &pool_id);
        assert_eq!(client.get_staking_pool(), Some(pool_id.clone()));

        // Alice deposits 200_000 into vault -> vault stakes into pool
        client.deposit(&alice, &200_000);
        assert_eq!(client.total_assets(), 200_000);
        assert_eq!(client.total_shares(), 200_000);
        assert_eq!(stake_client.balance(&pool_id), 200_000);

        // Staking pool accrues 10_000 yield
        stake_sac.mint(&pool_id, &10_000);
        pool_client.set_pending_reward(&10_000);

        // Bot triggers harvest
        let net = client.harvest(&bot);
        assert_eq!(net, 9_750); // 10,000 - 200 (perf fee) - 50 (bounty)
        assert_eq!(stake_client.balance(&bot), 50);
        assert_eq!(stake_client.balance(&rev_dist), 200);

        // Net yield was restaked into pool: 200,000 + 9,750 = 209,750
        assert_eq!(stake_client.balance(&pool_id), 209_750);
        assert_eq!(client.total_assets(), 209_750);

        // Alice redeems her shares and receives principal + net yield
        let alice_before = stake_client.balance(&alice);
        let returned = client.redeem(&alice, &200_000);
        assert_eq!(returned, 209_750);
        assert_eq!(stake_client.balance(&alice), alice_before + 209_750);
        assert_eq!(client.total_shares(), 0);
        assert_eq!(client.total_assets(), 0);
    }

    #[test]
    fn test_custom_fee_configuration_and_limits() {
        let (env, contract_id, admin, _alice, _bob, _reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        // 3% performance fee (300 bps), 1% caller bounty (100 bps)
        client.set_fees(&admin, &300, &100);
        assert_eq!(client.get_fees(), (300, 100));
    }

    #[test]
    #[should_panic(expected = "fees exceed 100%")]
    fn test_fees_cannot_exceed_100_percent() {
        let (env, contract_id, admin, _alice, _bob, _reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        client.set_fees(&admin, &9000, &2000);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_unauthorized_fee_configuration() {
        let (env, contract_id, _admin, alice, _bob, _reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        client.set_fees(&alice, &100, &50);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_paused_vault_blocks_deposit() {
        let (env, contract_id, _admin, alice, _bob, _reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        let reg_id = env.register(MockRegistry, ());
        let reg_client = MockRegistryClient::new(&env, &reg_id);
        reg_client.set_paused(&true);
        client.set_security_registry(&reg_id);

        client.deposit(&alice, &100);
    }

    #[test]
    #[should_panic(expected = "no yield to harvest")]
    fn test_harvest_with_no_yield_panics() {
        let (env, contract_id, _admin, _alice, _bob, _reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);
        let bot = Address::generate(&env);
        client.harvest(&bot);
    }
}
