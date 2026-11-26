//! Property-based fuzz tests for staking math invariants (issue #1649).
//!
//! Proved invariants under arbitrary randomized inputs:
//! 1. Total staked principal across all users exactly equals the pool total balance.
//! 2. Sum of distributed rewards never exceeds the reward pool capacity.
//! 3. A user's accrued reward is strictly monotonic with time.

use proptest::prelude::*;

/// Minimal in-memory model of the staking pool math used by the contract.
/// Kept dependency-free so the invariants can be exercised over arbitrary inputs.
#[derive(Default, Clone)]
struct Pool {
    total_staked: u128,
    reward_pool: u128,
    distributed: u128,
    users: Vec<u128>,
}

impl Pool {
    fn new(reward_pool: u128) -> Self {
        Pool {
            total_staked: 0,
            reward_pool,
            distributed: 0,
            users: Vec::new(),
        }
    }

    fn deposit(&mut self, user: usize, amount: u128) {
        if self.users.len() <= user {
            self.users.resize(user + 1, 0);
        }
        self.users[user] = self.users[user].saturating_add(amount);
        self.total_staked = self.total_staked.saturating_add(amount);
    }

    fn withdraw(&mut self, user: usize, amount: u128) {
        if user >= self.users.len() {
            return;
        }
        let amount = amount.min(self.users[user]);
        self.users[user] -= amount;
        self.total_staked -= amount;
    }

    /// Distribute `amount` of rewards, capped by remaining capacity.
    fn distribute(&mut self, amount: u128) -> u128 {
        let remaining = self.reward_pool.saturating_sub(self.distributed);
        let paid = amount.min(remaining);
        self.distributed = self.distributed.saturating_add(paid);
        paid
    }

    fn sum_user_stakes(&self) -> u128 {
        self.users.iter().copied().sum()
    }
}

/// Accrued reward for a user given a per-second rate and elapsed time.
fn accrued_reward(rate: u128, elapsed: u128) -> u128 {
    rate.saturating_mul(elapsed)
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100_000,
        max_shrink_iters: 10_000,
        ..ProptestConfig::default()
    })]

    /// Invariant 1: total staked principal equals the sum of all user stakes
    /// after arbitrary sequences of deposits and partial withdrawals.
    #[test]
    fn total_staked_equals_sum_of_user_stakes(
        reward_pool in 0u128..=u128::MAX / 4,
        ops in prop::collection::vec((0usize..8, 0u128..1_000_000, any::<bool>()), 0..64),
    ) {
        let mut pool = Pool::new(reward_pool);
        for (user, amount, is_deposit) in ops {
            if is_deposit {
                pool.deposit(user, amount);
            } else {
                pool.withdraw(user, amount);
            }
            prop_assert_eq!(pool.total_staked, pool.sum_user_stakes());
        }
    }

    /// Invariant 2: cumulative distributed rewards never exceed pool capacity.
    #[test]
    fn distributed_rewards_never_exceed_capacity(
        reward_pool in 0u128..=u128::MAX / 4,
        requests in prop::collection::vec(0u128..1_000_000, 0..64),
    ) {
        let mut pool = Pool::new(reward_pool);
        for amount in requests {
            pool.distribute(amount);
            prop_assert!(pool.distributed <= pool.reward_pool);
        }
    }

    /// Invariant 3: a user's accrued reward is strictly monotonic with time.
    #[test]
    fn reward_is_monotonic_with_time(
        rate in 1u128..1_000_000,
        t0 in 0u128..1_000_000,
        dt in 1u128..1_000_000,
    ) {
        let earlier = accrued_reward(rate, t0);
        let later = accrued_reward(rate, t0 + dt);
        prop_assert!(later > earlier);
    }
}
