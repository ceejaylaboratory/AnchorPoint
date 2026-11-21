//! Yield Distribution & Reward Sharing Contract
//!
//! Uses the "reward-per-token accumulator" pattern to achieve O(1) reward
//! calculation per user, avoiding O(n) iteration over all holders.
//!
//! Core invariant:
//!   reward_debt[user] = stake[user] * reward_per_token_stored
//!
//! Pending rewards for a user:
//!   pending = stake[user] * (reward_per_token_stored - reward_per_token_paid[user])
//!                         / PRECISION
//!             + rewards[user]
//!
//! The contract also hosts an ERC-4626 style auto-compounding vault. Vault
//! shares represent a proportional claim on `vault_total_assets`. `harvest`
//! collects yield from the underlying pool, sends a performance fee and a
//! caller bounty, then reinvests the remainder as principal. Because share
//! supply is unchanged by harvesting, the share price grows monotonically.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, vec, Address, Env, IntoVal, Symbol,
};

// Fixed-point precision: 1e18
const PRECISION: i128 = 1_000_000_000_000_000_000;

// Basis points denominator (2% = 200, 0.5% = 50).
const BPS_DENOMINATOR: u32 = 10_000;

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Address of the staking token
    StakeToken,
    /// Address of the reward token
    RewardToken,
    /// Contract admin
    Admin,
    /// Total tokens staked across all users
    TotalStaked,
    /// Global accumulated reward per staked token (scaled by PRECISION)
    RewardPerTokenStored,
    /// Per-user staked balance
    Stake(Address),
    /// Snapshot of RewardPerTokenStored at the last time a user interacted
    UserRewardPerTokenPaid(Address),
    /// Accrued but unclaimed rewards for a user
    Rewards(Address),

    // ── ERC-4626 auto-compounding vault ─────────────────────────────────
    /// Asset token (principal) managed by the vault
    VaultAsset,
    /// Optional contract supplying accrued yield via `collect_yield(recipient)`
    YieldSource,
    /// Address receiving the performance fee
    RevenueDistributor,
    /// Performance fee in basis points
    PerformanceFeeBps,
    /// Caller bounty in basis points
    CallerBountyBps,
    /// Accounted principal denominated in the vault asset
    VaultTotalAssets,
    /// Total vault shares in circulation (ERC-4626 `totalSupply`)
    VaultTotalShares,
    /// Per-user vault share balance (ERC-4626 `balanceOf`)
    VaultShares(Address),
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct YieldDistribution;

#[contractimpl]
impl YieldDistribution {

    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env.storage().instance().has(&soroban_sdk::symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage().instance().set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
        env.events()
            .publish((symbol_short!("sec_reg"),), registry);
    }

    // ── Admin / initialisation ────────────────────────────────────────────

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
        env.events()
            .publish((symbol_short!("init"),), (admin, stake_token, reward_token));
    }

    /// Deposit `amount` of reward tokens into the contract for distribution.
    /// Calling this increases `reward_per_token_stored` proportionally.
    ///
    /// O(1) — no iteration over holders.
    pub fn deposit_rewards(env: Env, from: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        from.require_auth();
        assert!(amount > 0, "amount must be positive");

        let total_staked: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);

        // Update state before external token transfer (reentrancy guard pattern).
        // If nobody is staking yet, rewards accumulate but can't be distributed —
        // they will be claimable once the first stake occurs (reward_per_token
        // stays 0 until then, so the deposited tokens sit idle).
        let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();

        // CEI: update state before external token transfer
        if total_staked > 0 {
            let mut rpt: i128 = env
                .storage()
                .instance()
                .get(&DataKey::RewardPerTokenStored)
                .unwrap_or(0);
            // Δ reward_per_token = amount * PRECISION / total_staked
            rpt = rpt.checked_add(
                amount.checked_mul(PRECISION).expect("rpt overflow") / total_staked
            ).expect("rpt overflow");
            env.storage()
                .instance()
                .set(&DataKey::RewardPerTokenStored, &rpt);
        }

        // Transfer reward tokens into the contract after state is updated
        let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
        // External interaction last
        token::Client::new(&env, &reward_token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        // Topic: event name only; from + amount in data.
        env.events()
            .publish((symbol_short!("dep_rwd"),), (from, amount));
    }

    // ── Staking ───────────────────────────────────────────────────────────

    /// Stake `amount` of the staking token.
    pub fn stake(env: Env, user: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        // Settle any pending rewards before changing the stake
        Self::_update_reward(&env, &user);

        // Update state before external token transfer (reentrancy guard pattern)
        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();

        // CEI: update state before external token transfer
        let prev: i128 = Self::_stake_of(&env, &user);
        env.storage()
            .persistent()
            .set(&DataKey::Stake(user.clone()), &prev.checked_add(amount).expect("stake overflow"));

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &total.checked_add(amount).expect("total staked overflow"));

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        // External interaction last
        token::Client::new(&env, &stake_token).transfer(
            &user,
            &env.current_contract_address(),
            &amount,
        );

        // Topic: event name only; user + amount in data.
        env.events()
            .publish((symbol_short!("staked"),), (user, amount));
    }

    /// Unstake `amount` of the staking token.
    pub fn unstake(env: Env, user: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        let prev = Self::_stake_of(&env, &user);
        assert!(prev >= amount, "insufficient stake");

        Self::_update_reward(&env, &user);

        env.storage()
            .persistent()
            .set(&DataKey::Stake(user.clone()), &prev.checked_sub(amount).expect("stake underflow"));

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &total.checked_sub(amount).expect("total staked underflow"));

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &env.current_contract_address(),
            &user,
            &amount,
        );

        // Topic: event name only; user + amount in data.
        env.events()
            .publish((symbol_short!("unstaked"),), (user, amount));
    }

    // ── Claiming ──────────────────────────────────────────────────────────

    /// Claim all accrued rewards for `user`.
    pub fn claim(env: Env, user: Address) -> i128 {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

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

    // ── Auto-compounding vault (ERC-4626) ────────────────────────────────

    /// Configure the vault once. `yield_source` may be `None` when yield is
    /// delivered directly to the vault address by an external pool.
    pub fn configure_vault(
        env: Env,
        admin: Address,
        asset: Address,
        yield_source: Option<Address>,
        revenue_distributor: Address,
        performance_fee_bps: u32,
        caller_bounty_bps: u32,
    ) {
        admin.require_auth();
        assert!(
            !env.storage().instance().has(&DataKey::VaultAsset),
            "vault already configured"
        );
        assert!(
            performance_fee_bps <= BPS_DENOMINATOR,
            "invalid performance fee"
        );
        assert!(
            caller_bounty_bps <= BPS_DENOMINATOR,
            "invalid caller bounty"
        );
        assert!(
            performance_fee_bps
                .checked_add(caller_bounty_bps)
                .expect("fee overflow")
                <= BPS_DENOMINATOR,
            "fees exceed 100%"
        );

        env.storage().instance().set(&DataKey::VaultAsset, &asset);
        env.storage()
            .instance()
            .set(&DataKey::RevenueDistributor, &revenue_distributor);
        if let Some(source) = yield_source.clone() {
            env.storage().instance().set(&DataKey::YieldSource, &source);
        }
        env.storage()
            .instance()
            .set(&DataKey::PerformanceFeeBps, &performance_fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::CallerBountyBps, &caller_bounty_bps);
        env.storage()
            .instance()
            .set(&DataKey::VaultTotalAssets, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::VaultTotalShares, &0_i128);

        env.events().publish(
            (symbol_short!("vlt_cfg"),),
            (asset, revenue_distributor, performance_fee_bps, caller_bounty_bps),
        );
        if let Some(source) = yield_source {
            env.events()
                .publish((symbol_short!("vlt_src"),), source);
        }
    }

    /// Update the configurable fee split (admin only).
    pub fn update_vault_fees(
        env: Env,
        admin: Address,
        performance_fee_bps: u32,
        caller_bounty_bps: u32,
    ) {
        admin.require_auth();
        assert!(env.storage().instance().has(&DataKey::VaultAsset), "vault not configured");
        assert!(performance_fee_bps <= BPS_DENOMINATOR, "invalid performance fee");
        assert!(caller_bounty_bps <= BPS_DENOMINATOR, "invalid caller bounty");
        assert!(
            performance_fee_bps
                .checked_add(caller_bounty_bps)
                .expect("fee overflow")
                <= BPS_DENOMINATOR,
            "fees exceed 100%"
        );
        env.storage()
            .instance()
            .set(&DataKey::PerformanceFeeBps, &performance_fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::CallerBountyBps, &caller_bounty_bps);
        env.events().publish(
            (symbol_short!("vlt_fee"),),
            (performance_fee_bps, caller_bounty_bps),
        );
    }

    /// Deposit `assets` and mint the proportional amount of vault shares.
    pub fn deposit(env: Env, user: Address, assets: i128) -> i128 {
        Self::_assert_not_paused(&env);
        user.require_auth();
        assert!(assets > 0, "amount must be positive");

        let asset = Self::_vault_asset(&env);
        let shares = Self::_convert_to_shares(&env, assets);
        assert!(shares > 0, "zero shares");

        let total_shares = Self::_total_shares(&env);
        let total_assets = Self::_total_assets(&env);
        let user_shares = Self::_shares_of(&env, &user);

        env.storage().instance().set(
            &DataKey::VaultTotalShares,
            &total_shares.checked_add(shares).expect("share overflow"),
        );
        env.storage().instance().set(
            &DataKey::VaultTotalAssets,
            &total_assets.checked_add(assets).expect("asset overflow"),
        );
        env.storage().persistent().set(
            &DataKey::VaultShares(user.clone()),
            &user_shares.checked_add(shares).expect("share overflow"),
        );

        token::Client::new(&env, &asset).transfer(
            &user,
            &env.current_contract_address(),
            &assets,
        );
        env.events()
            .publish((symbol_short!("vlt_dep"),), (user, assets, shares));
        shares
    }

    /// Mint exactly `shares` by depositing the required amount of assets.
    pub fn mint(env: Env, user: Address, shares: i128) -> i128 {
        Self::_assert_not_paused(&env);
        user.require_auth();
        assert!(shares > 0, "shares must be positive");

        let asset = Self::_vault_asset(&env);
        let assets = Self::_convert_to_assets_ceil(&env, shares);
        assert!(assets > 0, "zero assets");

        let total_shares = Self::_total_shares(&env);
        let total_assets = Self::_total_assets(&env);
        let user_shares = Self::_shares_of(&env, &user);

        env.storage().instance().set(
            &DataKey::VaultTotalShares,
            &total_shares.checked_add(shares).expect("share overflow"),
        );
        env.storage().instance().set(
            &DataKey::VaultTotalAssets,
            &total_assets.checked_add(assets).expect("asset overflow"),
        );
        env.storage().persistent().set(
            &DataKey::VaultShares(user.clone()),
            &user_shares.checked_add(shares).expect("share overflow"),
        );

        token::Client::new(&env, &asset).transfer(
            &user,
            &env.current_contract_address(),
            &assets,
        );
        env.events()
            .publish((symbol_short!("vlt_mnt"),), (user, assets, shares));
        assets
    }

    /// Withdraw `assets`, burning the proportional amount of shares.
    pub fn withdraw(env: Env, user: Address, assets: i128) -> i128 {
        Self::_assert_not_paused(&env);
        user.require_auth();
        assert!(assets > 0, "amount must be positive");

        let asset = Self::_vault_asset(&env);
        let shares = Self::_convert_to_shares_ceil(&env, assets);
        let user_shares = Self::_shares_of(&env, &user);
        assert!(user_shares >= shares, "insufficient shares");
        assert!(Self::_total_assets(&env) >= assets, "insufficient assets");

        let total_shares = Self::_total_shares(&env);
        let total_assets = Self::_total_assets(&env);

        env.storage().instance().set(
            &DataKey::VaultTotalShares,
            &total_shares.checked_sub(shares).expect("share underflow"),
        );
        env.storage().instance().set(
            &DataKey::VaultTotalAssets,
            &total_assets.checked_sub(assets).expect("asset underflow"),
        );
        env.storage().persistent().set(
            &DataKey::VaultShares(user.clone()),
            &user_shares.checked_sub(shares).expect("share underflow"),
        );

        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &user,
            &assets,
        );
        env.events()
            .publish((symbol_short!("vlt_wdr"),), (user, assets, shares));
        assets
    }

    /// Redeem `shares` for the proportional amount of assets.
    pub fn redeem(env: Env, user: Address, shares: i128) -> i128 {
        Self::_assert_not_paused(&env);
        user.require_auth();
        assert!(shares > 0, "shares must be positive");

        let asset = Self::_vault_asset(&env);
        let assets = Self::_convert_to_assets(&env, shares);
        let user_shares = Self::_shares_of(&env, &user);
        assert!(user_shares >= shares, "insufficient shares");
        assert!(assets > 0, "zero assets");

        let total_shares = Self::_total_shares(&env);
        let total_assets = Self::_total_assets(&env);

        env.storage().instance().set(
            &DataKey::VaultTotalShares,
            &total_shares.checked_sub(shares).expect("share underflow"),
        );
        env.storage().instance().set(
            &DataKey::VaultTotalAssets,
            &total_assets.checked_sub(assets).expect("asset underflow"),
        );
        env.storage().persistent().set(
            &DataKey::VaultShares(user.clone()),
            &user_shares.checked_sub(shares).expect("share underflow"),
        );

        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &user,
            &assets,
        );
        env.events()
            .publish((symbol_short!("vlt_rdm"),), (user, assets, shares));
        assets
    }

    /// Collect accrued yield, pay the performance fee and caller bounty, then
    /// reinvest the rest as principal. Permissionless: anyone may call and
    /// the caller receives the configured bounty.
    pub fn harvest(env: Env, caller: Address) -> i128 {
        Self::_assert_not_paused(&env);
        let asset = Self::_vault_asset(&env);

        if let Some(source) = env.storage().instance().get::<_, Address>(&DataKey::YieldSource) {
            // The source transfers accrued asset tokens to this contract. The
            // return value is intentionally ignored: yield is derived from the
            // actual asset balance, so a malicious source cannot over-credit.
            let _collected: i128 = env.invoke_contract(
                &source,
                &Symbol::new(&env, "collect_yield"),
                (env.current_contract_address(),).into_val(&env),
            );
        }

        let balance = token::Client::new(&env, &asset).balance(&env.current_contract_address());
        let principal = Self::_total_assets(&env);
        assert!(balance > principal, "no yield to harvest");
        let yield_amount = balance.checked_sub(principal).expect("yield underflow");

        let performance_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PerformanceFeeBps)
            .expect("vault not configured");
        let bounty_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CallerBountyBps)
            .expect("vault not configured");
        let distributor: Address = env
            .storage()
            .instance()
            .get(&DataKey::RevenueDistributor)
            .expect("vault not configured");

        let performance_fee = yield_amount
            .checked_mul(performance_bps as i128)
            .expect("fee overflow")
            / BPS_DENOMINATOR as i128;
        let caller_bounty = yield_amount
            .checked_mul(bounty_bps as i128)
            .expect("bounty overflow")
            / BPS_DENOMINATOR as i128;
        let net = yield_amount
            .checked_sub(performance_fee)
            .expect("fee underflow")
            .checked_sub(caller_bounty)
            .expect("bounty underflow");

        // CEI: principal grows before any external transfer. Share supply is
        // untouched, so every existing share gains value proportionally.
        env.storage().instance().set(
            &DataKey::VaultTotalAssets,
            &principal.checked_add(net).expect("asset overflow"),
        );

        if performance_fee > 0 {
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &distributor,
                &performance_fee,
            );
        }
        if caller_bounty > 0 {
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &caller,
                &caller_bounty,
            );
        }

        env.events().publish(
            (symbol_short!("harvest"),),
            (caller, yield_amount, net, performance_fee, caller_bounty),
        );
        net
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

    // ── Vault views (ERC-4626) ────────────────────────────────────────────

    /// Accounted principal held by the vault.
    pub fn total_assets(env: Env) -> i128 {
        Self::_total_assets(&env)
    }

    /// Total vault shares in circulation (ERC-4626 `totalSupply`).
    pub fn total_supply(env: Env) -> i128 {
        Self::_total_shares(&env)
    }

    /// Vault shares owned by `user` (ERC-4626 `balanceOf`).
    pub fn balance_of(env: Env, user: Address) -> i128 {
        Self::_shares_of(&env, &user)
    }

    /// Assets redeemable for `assets` deposited now (rounded down).
    pub fn convert_to_shares(env: Env, assets: i128) -> i128 {
        Self::_convert_to_shares(&env, assets)
    }

    /// Assets backing `shares` (rounded down).
    pub fn convert_to_assets(env: Env, shares: i128) -> i128 {
        Self::_convert_to_assets(&env, shares)
    }

    /// Alias of `convert_to_shares` for ERC-4626 tooling.
    pub fn preview_deposit(env: Env, assets: i128) -> i128 {
        Self::_convert_to_shares(&env, assets)
    }

    /// Assets required to mint `shares` (rounded up).
    pub fn preview_mint(env: Env, shares: i128) -> i128 {
        Self::_convert_to_assets_ceil(&env, shares)
    }

    /// Shares burned when withdrawing `assets` (rounded up).
    pub fn preview_withdraw(env: Env, assets: i128) -> i128 {
        Self::_convert_to_shares_ceil(&env, assets)
    }

    /// Assets returned when redeeming `shares` (rounded down).
    pub fn preview_redeem(env: Env, shares: i128) -> i128 {
        Self::_convert_to_assets(&env, shares)
    }

    /// Assets per share scaled by `PRECISION`. Starts at 1.0 and increases
    /// after every harvest that reinvests a positive net yield.
    pub fn share_price(env: Env) -> i128 {
        let total_shares = Self::_total_shares(&env);
        if total_shares == 0 {
            return PRECISION;
        }
        Self::_total_assets(&env)
            .checked_mul(PRECISION)
            .expect("price overflow")
            / total_shares
    }

    /// Uncompounded yield currently held by the vault.
    pub fn pending_yield(env: Env) -> i128 {
        let asset = Self::_vault_asset(&env);
        let balance = token::Client::new(&env, &asset).balance(&env.current_contract_address());
        balance.saturating_sub(Self::_total_assets(&env))
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    /// Settle pending rewards into `rewards[user]` and snapshot the current
    /// `reward_per_token_stored` for the user. Must be called before any
    /// operation that changes a user's stake.
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
            env.storage()
                .persistent()
                .set(&DataKey::Rewards(user.clone()), &prev.checked_add(earned).expect("rewards overflow"));
        }

        // Snapshot current global rate for this user
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

    fn _assert_not_paused(env: &Env) {
        if let Some(registry) = env.storage().instance().get::<_, Address>(&symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &Symbol::new(env, "is_paused"), vec![env]);
            assert!(!is_paused, "contract is paused");
        }
    }

    fn _vault_asset(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::VaultAsset).expect("vault not configured")
    }

    fn _total_assets(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::VaultTotalAssets).unwrap_or(0)
    }

    fn _total_shares(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::VaultTotalShares).unwrap_or(0)
    }

    fn _shares_of(env: &Env, user: &Address) -> i128 {
        env.storage().persistent().get(&DataKey::VaultShares(user.clone())).unwrap_or(0)
    }

    fn _convert_to_shares(env: &Env, assets: i128) -> i128 {
        let total_shares = Self::_total_shares(env);
        if total_shares == 0 {
            return assets;
        }
        assets
            .checked_mul(total_shares)
            .expect("shares overflow")
            / Self::_total_assets(env)
    }

    fn _convert_to_assets(env: &Env, shares: i128) -> i128 {
        let total_shares = Self::_total_shares(env);
        if total_shares == 0 {
            return shares;
        }
        shares
            .checked_mul(Self::_total_assets(env))
            .expect("assets overflow")
            / total_shares
    }

    fn _convert_to_shares_ceil(env: &Env, assets: i128) -> i128 {
        let total_shares = Self::_total_shares(env);
        if total_shares == 0 {
            return assets;
        }
        let total_assets = Self::_total_assets(env);
        let numerator = assets.checked_mul(total_shares).expect("shares overflow");
        numerator / total_assets + if numerator % total_assets != 0 { 1 } else { 0 }
    }

    fn _convert_to_assets_ceil(env: &Env, shares: i128) -> i128 {
        let total_shares = Self::_total_shares(env);
        if total_shares == 0 {
            return shares;
        }
        let total_assets = Self::_total_assets(env);
        let numerator = shares.checked_mul(total_assets).expect("assets overflow");
        numerator / total_shares + if numerator % total_shares != 0 { 1 } else { 0 }
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
            env.storage().instance().get(&symbol_short!("paused")).unwrap_or(false)
        }
        pub fn set_paused(env: Env, paused: bool) {
            env.storage().instance().set(&symbol_short!("paused"), &paused);
        }
    }

    fn setup() -> (Env, Address, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        // Deploy mock SAC tokens
        let stake_token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let reward_token_id = env.register_stellar_asset_contract_v2(admin.clone());

        let stake_sac = StellarAssetClient::new(&env, &stake_token_id.address());
        let reward_sac = StellarAssetClient::new(&env, &reward_token_id.address());

        // Mint tokens to participants
        stake_sac.mint(&alice, &1_000_000);
        stake_sac.mint(&bob, &1_000_000);
        reward_sac.mint(&admin, &10_000_000);

        let contract_id = env.register_contract(None, YieldDistribution);
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

    /// Stands in for an underlying staking pool: on `collect_yield` it mints
    /// the configured amount of the vault asset directly to the vault.
    #[contract]
    pub struct MockYieldSource;
    #[contractimpl]
    impl MockYieldSource {
        pub fn set_yield(env: Env, token: Address, amount: i128) {
            env.storage().instance().set(&symbol_short!("y_tok"), &token);
            env.storage().instance().set(&symbol_short!("y_amt"), &amount);
        }

        pub fn collect_yield(env: Env, recipient: Address) -> i128 {
            let token: Address = env.storage().instance().get(&symbol_short!("y_tok")).unwrap();
            let amount: i128 = env
                .storage()
                .instance()
                .get(&symbol_short!("y_amt"))
                .unwrap_or(0);
            if amount > 0 {
                StellarAssetClient::new(&env, &token).mint(&recipient, &amount);
                env.storage()
                    .instance()
                    .set(&symbol_short!("y_amt"), &0_i128);
            }
            amount
        }
    }

    /// Returns: env, vault id, admin, alice, bob, keeper, distributor,
    /// asset address, mock yield source id.
    fn setup_vault(
        performance_bps: u32,
        bounty_bps: u32,
        use_source: bool,
    ) -> (Env, Address, Address, Address, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let keeper = Address::generate(&env);
        let distributor = Address::generate(&env);

        let asset_id = env.register_stellar_asset_contract_v2(admin.clone());
        let asset = asset_id.address();
        let asset_sac = StellarAssetClient::new(&env, &asset);
        asset_sac.mint(&alice, &1_000_000);
        asset_sac.mint(&bob, &1_000_000);

        let contract_id = env.register_contract(None, YieldDistribution);
        let client = YieldDistributionClient::new(&env, &contract_id);
        client.initialize(&admin, &asset, &asset);

        let source_id = env.register_contract(None, MockYieldSource);
        let source = if use_source { Some(source_id.clone()) } else { None };
        client.configure_vault(
            &admin,
            &asset,
            &source,
            &distributor,
            &performance_bps,
            &bounty_bps,
        );

        (
            env,
            contract_id,
            admin,
            alice,
            bob,
            keeper,
            distributor,
            asset,
            source_id,
        )
    }

    #[test]
    fn test_stake_and_claim() {
        let (env, contract_id, admin, alice, _bob, reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        // Alice stakes 500_000
        client.stake(&alice, &500_000);
        assert_eq!(client.total_staked(), 500_000);

        // Admin deposits 1_000 reward tokens
        client.deposit_rewards(&admin, &1_000);

        // Alice should have all 1_000 pending
        assert_eq!(client.pending_rewards(&alice), 1_000);

        // Alice claims
        let claimed = client.claim(&alice);
        assert_eq!(claimed, 1_000);
        assert_eq!(client.pending_rewards(&alice), 0);

        // Verify token balance
        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 1_000);
    }

    #[test]
    fn test_proportional_split() {
        let (env, contract_id, admin, alice, bob, _, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        // Alice: 300_000, Bob: 700_000  →  30% / 70% split
        client.stake(&alice, &300_000);
        client.stake(&bob, &700_000);

        client.deposit_rewards(&admin, &1_000);

        // Allow rounding: 300 / 700
        assert_eq!(client.pending_rewards(&alice), 300);
        assert_eq!(client.pending_rewards(&bob), 700);
    }

    #[test]
    fn test_rewards_accrue_correctly_after_late_stake() {
        let (env, contract_id, admin, alice, bob, _, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        // Alice stakes first, rewards deposited, then Bob joins
        client.stake(&alice, &500_000);
        client.deposit_rewards(&admin, &1_000);

        // Bob stakes after the first reward deposit
        client.stake(&bob, &500_000);
        client.deposit_rewards(&admin, &1_000);

        // Alice: 1_000 (first round, solo) + 500 (second round, 50/50) = 1_500
        // Bob:   0 (missed first round)    + 500 (second round, 50/50) = 500
        assert_eq!(client.pending_rewards(&alice), 1_500);
        assert_eq!(client.pending_rewards(&bob), 500);
    }

    #[test]
    fn test_unstake_settles_rewards() {
        let (env, contract_id, admin, alice, _bob, reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        client.stake(&alice, &500_000);
        client.deposit_rewards(&admin, &1_000);

        // Unstake should settle rewards without claiming
        client.unstake(&alice, &500_000);
        assert_eq!(client.stake_of(&alice), 0);
        assert_eq!(client.pending_rewards(&alice), 1_000); // still claimable

        client.claim(&alice);
        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 1_000);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_pause_deposit_rewards() {
        let (env, contract_id, admin, _alice, _bob, _, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        let registry_id = env.register_contract(None, MockRegistry);
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
        
        // Initial state
        assert_eq!(client.total_staked(), 0);
        assert_eq!(stake_client.balance(&contract_id), 0);
        
        // Alice stakes
        client.stake(&alice, &300_000);
        assert_eq!(client.total_staked(), 300_000);
        assert_eq!(stake_client.balance(&contract_id), 300_000);
        
        // Bob stakes
        client.stake(&bob, &700_000);
        assert_eq!(client.total_staked(), 1_000_000);
        assert_eq!(stake_client.balance(&contract_id), 1_000_000);
        
        // Total supply matches balance reserves invariant
        assert_eq!(client.total_staked(), stake_client.balance(&contract_id));
        
        // Alice unstakes partially
        client.unstake(&alice, &100_000);
        assert_eq!(client.total_staked(), 900_000);
        assert_eq!(stake_client.balance(&contract_id), 900_000);
        
        // Sum of all stakes equals total staked
        assert_eq!(client.stake_of(&alice) + client.stake_of(&bob), client.total_staked());
    }

    #[test]
    fn test_compound_interest_formula_over_time() {
        let (env, contract_id, admin, alice, bob, reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        // Alice stakes 1_000_000, Bob stakes 1_000_000
        client.stake(&alice, &1_000_000);
        client.stake(&bob, &1_000_000);

        // Deposit 10_000 reward tokens — 50/50 split
        client.deposit_rewards(&admin, &10_000);

        // Each should have 5_000 pending (1_000_000 * 10_000 / 2_000_000)
        assert_eq!(client.pending_rewards(&alice), 5_000);
        assert_eq!(client.pending_rewards(&bob), 5_000);

        // Alice claims her rewards
        let alice_claimed = client.claim(&alice);
        assert_eq!(alice_claimed, 5_000);

        // Deposit another 10_000 — now total staked is still 2_000_000
        // Alice's new reward rate: 10_000 * PRECISION / 2_000_000 = 5_000_000_000_000_000
        // Alice's pending from this deposit: 1_000_000 * 5_000_000_000_000_000 / PRECISION = 5_000
        // Bob's pending from this deposit: same = 5_000
        client.deposit_rewards(&admin, &10_000);

        assert_eq!(client.pending_rewards(&alice), 5_000);
        // Bob never claimed the first deposit, so both rounds are pending.
        assert_eq!(client.pending_rewards(&bob), 10_000);

        // Bob claims — should get 5_000 from first deposit + 5_000 from second = 10_000 total
        let bob_claimed = client.claim(&bob);
        assert_eq!(bob_claimed, 10_000);

        // Verify token balances
        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 5_000);
        assert_eq!(reward_client.balance(&bob), 10_000);
    }

    #[test]
    fn test_compound_interest_with_multiple_deposits() {
        let (env, contract_id, admin, alice, _bob, reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        // Alice stakes 500_000
        client.stake(&alice, &500_000);

        // Three separate reward deposits
        client.deposit_rewards(&admin, &1_000);
        client.deposit_rewards(&admin, &1_000);
        client.deposit_rewards(&admin, &1_000);

        // Total rewards = 3_000, Alice is the only staker so she gets all
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

        // Alice stakes 1, Bob stakes 999_999 — very uneven split
        client.stake(&alice, &1);
        client.stake(&bob, &999_999);

        // Deposit 1_000_000 reward tokens
        client.deposit_rewards(&admin, &1_000_000);

        // Alice should get 1 * 1_000_000 / 1_000_000 = 1
        // Bob should get 999_999 * 1_000_000 / 1_000_000 = 999_999
        assert_eq!(client.pending_rewards(&alice), 1);
        assert_eq!(client.pending_rewards(&bob), 999_999);

        // Alice claims her 1 token
        assert_eq!(client.claim(&alice), 1);

        // Deposit another 1_000_000 — now total staked is still 1_000_000
        // Alice's reward: 1 * 1_000_000 / 1_000_000 = 1
        // Bob's reward: 999_999 * 1_000_000 / 1_000_000 = 999_999
        client.deposit_rewards(&admin, &1_000_000);

        assert_eq!(client.pending_rewards(&alice), 1);
        // Bob never claimed the first deposit, so both rounds are pending.
        assert_eq!(client.pending_rewards(&bob), 1_999_998);

        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 1);
    }

    #[test]
    fn test_compound_interest_accrual_after_unstake() {
        let (env, contract_id, admin, alice, bob, reward_token, _stake_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        // Both stake equally
        client.stake(&alice, &500_000);
        client.stake(&bob, &500_000);

        // First reward deposit
        client.deposit_rewards(&admin, &10_000);

        // Both should have 5_000 pending
        assert_eq!(client.pending_rewards(&alice), 5_000);
        assert_eq!(client.pending_rewards(&bob), 5_000);

        // Alice unstakes her full stake
        client.unstake(&alice, &500_000);

        // Alice's pending should still be 5_000 (accrued but not claimed)
        assert_eq!(client.pending_rewards(&alice), 5_000);

        // Bob still has 5_000 pending
        assert_eq!(client.pending_rewards(&bob), 5_000);

        // Second reward deposit — only Bob is staked now
        client.deposit_rewards(&admin, &10_000);

        // Bob should now have 5_000 + 10_000 = 15_000 pending
        assert_eq!(client.pending_rewards(&bob), 15_000);

        // Alice's pending should still be 5_000 (she already unstaked)
        assert_eq!(client.pending_rewards(&alice), 5_000);

        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 0);
        assert_eq!(reward_client.balance(&bob), 0);
    }

    // ── ERC-4626 auto-compounding vault tests ─────────────────────────────

    #[test]
    fn test_vault_deposit_and_withdraw_roundtrip() {
        let (env, contract_id, _admin, alice, bob, _keeper, _distributor, asset, _) =
            setup_vault(200, 50, false);
        let client = YieldDistributionClient::new(&env, &contract_id);
        let token = TokenClient::new(&env, &asset);

        assert_eq!(client.share_price(), PRECISION);
        assert_eq!(client.deposit(&alice, &100_000), 100_000);
        assert_eq!(client.deposit(&bob, &100_000), 100_000);
        assert_eq!(client.total_supply(), 200_000);
        assert_eq!(client.total_assets(), 200_000);
        assert_eq!(client.balance_of(&alice), 100_000);
        assert_eq!(token.balance(&contract_id), 200_000);

        assert_eq!(client.withdraw(&alice, &100_000), 100_000);
        assert_eq!(client.balance_of(&alice), 0);
        assert_eq!(client.total_supply(), 100_000);
        assert_eq!(client.total_assets(), 100_000);
        assert_eq!(token.balance(&alice), 1_000_000);
        assert_eq!(token.balance(&contract_id), 100_000);
    }

    #[test]
    fn test_harvest_compounds_yield_and_distributes_fees() {
        let (env, contract_id, _admin, alice, _bob, keeper, distributor, asset, _) =
            setup_vault(200, 50, false);
        let client = YieldDistributionClient::new(&env, &contract_id);
        let token = TokenClient::new(&env, &asset);

        client.deposit(&alice, &1_000_000);

        // Simulate accrued yield arriving from the underlying staking pool.
        StellarAssetClient::new(&env, &asset).mint(&contract_id, &10_000);
        assert_eq!(client.pending_yield(), 10_000);

        let net = client.harvest(&keeper);
        assert_eq!(net, 9_750); // 10_000 - 2% (200) - 0.5% (50)
        assert_eq!(client.pending_yield(), 0);
        assert_eq!(client.total_assets(), 1_009_750);
        assert_eq!(client.total_supply(), 1_000_000);
        assert_eq!(
            client.share_price(),
            1_009_750_i128 * PRECISION / 1_000_000
        );
        assert_eq!(client.convert_to_assets(&1_000_000), 1_009_750);

        assert_eq!(token.balance(&distributor), 200);
        assert_eq!(token.balance(&keeper), 50);
        assert_eq!(token.balance(&contract_id), 1_009_750);
    }

    #[test]
    fn test_share_price_increases_monotonically_over_harvest_cycles() {
        let (env, contract_id, _admin, alice, bob, keeper, _distributor, asset, _) =
            setup_vault(200, 50, false);
        let client = YieldDistributionClient::new(&env, &contract_id);
        let asset_sac = StellarAssetClient::new(&env, &asset);

        client.deposit(&alice, &1_000_000);
        client.deposit(&bob, &1_000_000);

        let mut last_price = client.share_price();
        let mut last_assets = client.convert_to_assets(&client.balance_of(&alice));
        for _ in 0..4 {
            asset_sac.mint(&contract_id, &10_000);
            client.harvest(&keeper);
            let price = client.share_price();
            assert!(price > last_price, "share price must strictly increase");
            let holder_assets = client.convert_to_assets(&client.balance_of(&alice));
            assert!(holder_assets > last_assets);
            last_price = price;
            last_assets = holder_assets;
        }

        // Withdrawal round-trip after compounding returns the grown principal.
        let shares = client.balance_of(&alice);
        let redeemed = client.redeem(&alice, &shares);
        assert!(redeemed > 1_000_000);
        assert_eq!(client.balance_of(&alice), 0);
        assert_eq!(client.total_supply(), 1_000_000);
        assert_eq!(TokenClient::new(&env, &asset).balance(&alice), redeemed);
    }

    #[test]
    fn test_harvest_collects_yield_from_configured_pool() {
        let (env, contract_id, _admin, alice, _bob, keeper, distributor, asset, source) =
            setup_vault(200, 50, true);
        let client = YieldDistributionClient::new(&env, &contract_id);
        let source_client = MockYieldSourceClient::new(&env, &source);
        let token = TokenClient::new(&env, &asset);

        client.deposit(&alice, &1_000_000);
        source_client.set_yield(&asset, &5_000);
        assert_eq!(client.pending_yield(), 0);

        assert_eq!(client.harvest(&keeper), 4_875);
        assert_eq!(client.total_assets(), 1_004_875);
        assert_eq!(token.balance(&distributor), 100);
        assert_eq!(token.balance(&keeper), 25);
        assert_eq!(token.balance(&contract_id), 1_004_875);
    }

    #[test]
    fn test_harvest_with_custom_fees_and_fee_update() {
        let (env, contract_id, admin, alice, _bob, keeper, distributor, asset, _) =
            setup_vault(1_000, 100, false);
        let client = YieldDistributionClient::new(&env, &contract_id);
        let token = TokenClient::new(&env, &asset);
        let asset_sac = StellarAssetClient::new(&env, &asset);

        client.deposit(&alice, &1_000_000);
        asset_sac.mint(&contract_id, &10_000);
        assert_eq!(client.harvest(&keeper), 8_900); // 10% + 1%
        assert_eq!(token.balance(&distributor), 1_000);
        assert_eq!(token.balance(&keeper), 100);

        client.update_vault_fees(&admin, &300, &70);
        asset_sac.mint(&contract_id, &10_000);
        assert_eq!(client.harvest(&keeper), 9_630); // 3% + 0.7%
        assert_eq!(token.balance(&distributor), 1_300);
        assert_eq!(token.balance(&keeper), 170);
    }

    #[test]
    fn test_harvest_with_full_fee_yield_leaves_price_unchanged() {
        let (env, contract_id, _admin, alice, _bob, keeper, _distributor, asset, _) =
            setup_vault(9_950, 50, false);
        let client = YieldDistributionClient::new(&env, &contract_id);
        let asset_sac = StellarAssetClient::new(&env, &asset);

        client.deposit(&alice, &1_000_000);
        asset_sac.mint(&contract_id, &10_000);
        assert_eq!(client.harvest(&keeper), 0);
        assert_eq!(client.total_assets(), 1_000_000);
        assert_eq!(client.share_price(), PRECISION);
    }

    #[test]
    fn test_share_pricing_for_late_depositor_after_compounding() {
        let (env, contract_id, _admin, alice, bob, keeper, _distributor, asset, _) =
            setup_vault(200, 50, false);
        let client = YieldDistributionClient::new(&env, &contract_id);

        client.deposit(&alice, &1_000_000);
        StellarAssetClient::new(&env, &asset).mint(&contract_id, &10_000);
        client.harvest(&keeper);
        assert!(client.share_price() > PRECISION);

        let shares = client.deposit(&bob, &100_000);
        assert!(shares < 100_000, "late depositor receives fewer shares");
        assert_eq!(client.balance_of(&bob), shares);
        assert!(client.convert_to_assets(&shares) <= 100_000);
        assert_eq!(client.preview_deposit(&100_000), shares);
        assert_eq!(client.preview_redeem(&shares), client.convert_to_assets(&shares));
        // `withdraw` rounds shares up to protect the remaining holders.
        assert_eq!(
            client.preview_withdraw(&100_000),
            client.convert_to_shares(&100_000) + 1
        );
        assert_eq!(client.preview_mint(&1), 2);
    }

    #[test]
    fn test_mint_and_redeem_roundtrip() {
        let (env, contract_id, _admin, alice, _bob, _keeper, _distributor, _asset, _) =
            setup_vault(200, 50, false);
        let client = YieldDistributionClient::new(&env, &contract_id);

        assert_eq!(client.mint(&alice, &1_000), 1_000);
        assert_eq!(client.balance_of(&alice), 1_000);
        assert_eq!(client.redeem(&alice, &400), 400);
        assert_eq!(client.balance_of(&alice), 600);
        assert_eq!(client.total_supply(), 600);
        assert_eq!(client.total_assets(), 600);
    }

    #[test]
    #[should_panic(expected = "no yield to harvest")]
    fn test_harvest_without_yield_panics() {
        let (env, contract_id, _admin, alice, _bob, keeper, _distributor, _asset, _) =
            setup_vault(200, 50, false);
        let client = YieldDistributionClient::new(&env, &contract_id);
        client.deposit(&alice, &1_000_000);
        client.harvest(&keeper);
    }

    #[test]
    #[should_panic(expected = "fees exceed 100%")]
    fn test_configure_vault_rejects_fees_over_100_percent() {
        let (env, _contract_id, admin, _alice, _bob, _keeper, distributor, asset, _) =
            setup_vault(200, 50, false);
        // Use a fresh, unconfigured contract so the fee validation is reached.
        let fresh_id = env.register_contract(None, YieldDistribution);
        let fresh_client = YieldDistributionClient::new(&env, &fresh_id);
        fresh_client.configure_vault(&admin, &asset, &None, &distributor, &9_000, &2_000);
    }

    #[test]
    #[should_panic(expected = "vault already configured")]
    fn test_configure_vault_twice_panics() {
        let (env, contract_id, admin, _alice, _bob, _keeper, distributor, asset, _) =
            setup_vault(200, 50, false);
        let client = YieldDistributionClient::new(&env, &contract_id);
        client.configure_vault(&admin, &asset, &None, &distributor, &200, &50);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_vault_operations_respect_pause_registry() {
        let (env, contract_id, _admin, alice, _bob, keeper, _distributor, asset, _) =
            setup_vault(200, 50, false);
        let client = YieldDistributionClient::new(&env, &contract_id);
        let registry_id = env.register_contract(None, MockRegistry);
        let registry_client = MockRegistryClient::new(&env, &registry_id);
        registry_client.set_paused(&true);
        client.set_security_registry(&registry_id);

        StellarAssetClient::new(&env, &asset).mint(&contract_id, &10_000);
        client.harvest(&keeper);
        let _ = alice;
    }
}
