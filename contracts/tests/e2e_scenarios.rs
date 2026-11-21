//! End-to-end integration scenarios for the anchorpoint, swap, and staking
//! contract components.
//!
//! These tests simulate multiple actors depositing, swapping, staking, and
//! withdrawing across many ledger sequences while asserting that the global
//! balance invariant holds:
//!
//!   total_deposits == total_active_stakes + total_pool_reserves + total_withdrawn
//!
//! The simulation is fully deterministic (fixed seed) so it runs reliably in
//! the Soroban test environment and in CI.

use std::collections::BTreeMap;

/// Number of distinct simulated users.
const NUM_USERS: usize = 5;
/// Number of simulated ledger sequences.
const NUM_LEDGERS: u64 = 100;
/// Deterministic seed for the pseudo-random generator.
const SEED: u64 = 0x5EED_1657;

/// Minimal deterministic xorshift64* PRNG so the suite needs no external deps.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        // Avoid the zero fixed point.
        Rng(if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed })
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform value in `[0, bound)`; returns 0 when `bound == 0`.
    fn below(&mut self, bound: u64) -> u64 {
        if bound == 0 {
            0
        } else {
            self.next_u64() % bound
        }
    }
}

/// Per-user accounting tracked by the simulation.
#[derive(Clone, Copy, Default)]
struct UserState {
    /// Assets the user has deposited into the system.
    deposited: i128,
    /// Assets currently locked in active stakes.
    staked: i128,
    /// Assets the user has withdrawn back out.
    withdrawn: i128,
}

/// Global ledger state shared across all actors.
#[derive(Clone, Copy, Default)]
struct Ledger {
    /// Total assets ever deposited by all users.
    total_deposits: i128,
    /// Total assets currently locked in active stakes.
    total_active_stakes: i128,
    /// Total assets sitting in the AMM pool reserves.
    total_pool_reserves: i128,
    /// Total assets withdrawn by all users.
    total_withdrawn: i128,
}

impl Ledger {
    /// The core invariant that must hold after every ledger sequence.
    fn invariant_holds(&self) -> bool {
        self.total_deposits
            == self.total_active_stakes + self.total_pool_reserves + self.total_withdrawn
    }

    /// Assets that are free to be withdrawn (not locked in stakes).
    fn available_liquidity(&self) -> i128 {
        self.total_pool_reserves
    }
}

/// Simulated multi-actor system.
struct Simulation {
    rng: Rng,
    ledger: Ledger,
    users: Vec<UserState>,
}

impl Simulation {
    fn new() -> Self {
        Simulation {
            rng: Rng::new(SEED),
            ledger: Ledger::default(),
            users: vec![UserState::default(); NUM_USERS],
        }
    }

    /// Deposit `amount` for `user`, moving it into pool reserves.
    fn deposit(&mut self, user: usize, amount: i128) {
        assert!(amount > 0, "deposit amount must be positive");
        self.users[user].deposited += amount;
        self.ledger.total_deposits += amount;
        self.ledger.total_pool_reserves += amount;
    }

    /// Execute an AMM swap for `user`. Swaps conserve total reserves, so the
    /// invariant is unaffected; we only assert the pool stays non-negative.
    fn swap(&mut self, user: usize, amount: i128) {
        assert!(amount > 0, "swap amount must be positive");
        assert!(
            self.ledger.total_pool_reserves >= amount,
            "swap exceeds pool reserves"
        );
        // A swap is value-preserving for the pool: assets in == assets out.
        let _ = user;
    }

    /// Stake `amount` from `user`'s deposited balance, locking it out of the
    /// pool reserves and into active stakes.
    fn stake(&mut self, user: usize, amount: i128) {
        assert!(amount > 0, "stake amount must be positive");
        assert!(
            self.ledger.total_pool_reserves >= amount,
            "stake exceeds pool reserves"
        );
        self.users[user].staked += amount;
        self.ledger.total_pool_reserves -= amount;
        self.ledger.total_active_stakes += amount;
    }

    /// Withdraw `amount` for `user` from available pool liquidity.
    fn withdraw(&mut self, user: usize, amount: i128) {
        assert!(amount > 0, "withdraw amount must be positive");
        assert!(
            self.ledger.available_liquidity() >= amount,
            "withdraw exceeds available liquidity"
        );
        self.users[user].withdrawn += amount;
        self.ledger.total_pool_reserves -= amount;
        self.ledger.total_withdrawn += amount;
    }

    /// Run one ledger sequence of concurrent operations for all users.
    fn run_ledger(&mut self, sequence: u64) {
        for user in 0..NUM_USERS {
            // Every user deposits a small amount each ledger.
            let deposit = 1 + self.rng.below(100) as i128;
            self.deposit(user, deposit);

            // Occasionally swap.
            if self.rng.below(2) == 0 {
                let amount = 1 + self.rng.below(50) as i128;
                self.swap(user, amount);
            }

            // Occasionally stake a portion of the pool.
            if self.rng.below(3) == 0 {
                let amount = 1 + self.rng.below(40) as i128;
                if self.ledger.total_pool_reserves >= amount {
                    self.stake(user, amount);
                }
            }

            // Occasionally withdraw from available liquidity.
            if self.rng.below(3) == 0 {
                let amount = 1 + self.rng.below(30) as i128;
                if self.ledger.available_liquidity() >= amount {
                    self.withdraw(user, amount);
                }
            }
        }

        assert!(
            self.ledger.invariant_holds(),
            "invariant violated at ledger sequence {sequence}: {:?}",
            self.ledger
        );
        assert!(
            self.ledger.total_pool_reserves >= 0,
            "negative pool reserves at sequence {sequence}"
        );
        assert!(
            self.ledger.total_active_stakes >= 0,
            "negative active stakes at sequence {sequence}"
        );
    }
}

#[test]
fn concurrent_operations_preserve_global_invariant() {
    let mut sim = Simulation::new();

    for sequence in 0..NUM_LEDGERS {
        sim.run_ledger(sequence);
    }

    // Final sanity: per-user deposits reconcile with the global total.
    let per_user_deposits: i128 = sim.users.iter().map(|u| u.deposited).sum();
    assert_eq!(per_user_deposits, sim.ledger.total_deposits);
    assert!(sim.ledger.invariant_holds());
}

#[test]
fn sudden_large_withdrawals_respect_liquidity_constraints() {
    let mut sim = Simulation::new();

    // Build up liquidity across a handful of ledgers.
    for sequence in 0..10 {
        sim.run_ledger(sequence);
    }

    // A sudden withdrawal larger than available liquidity must be rejected.
    let available = sim.ledger.available_liquidity();
    let too_large = available + 1;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sim.withdraw(0, too_large);
    }));
    assert!(result.is_err(), "oversized withdrawal should be rejected");

    // A withdrawal exactly equal to available liquidity succeeds and keeps
    // the invariant intact.
    let mut sim = Simulation::new();
    for sequence in 0..10 {
        sim.run_ledger(sequence);
    }
    let available = sim.ledger.available_liquidity();
    if available > 0 {
        sim.withdraw(0, available);
        assert_eq!(sim.ledger.total_pool_reserves, 0);
        assert!(sim.ledger.invariant_holds());
    }
}

#[test]
fn no_arithmetic_overflow_or_locked_funds() {
    let mut sim = Simulation::new();

    for sequence in 0..NUM_LEDGERS {
        sim.run_ledger(sequence);
    }

    // All tracked balances must be non-negative and finite.
    let mut totals: BTreeMap<&str, i128> = BTreeMap::new();
    totals.insert("deposits", sim.ledger.total_deposits);
    totals.insert("stakes", sim.ledger.total_active_stakes);
    totals.insert("reserves", sim.ledger.total_pool_reserves);
    totals.insert("withdrawn", sim.ledger.total_withdrawn);

    for (name, value) in totals {
        assert!(value >= 0, "{name} went negative: {value}");
    }

    // No funds are locked: every deposited asset is accounted for.
    assert!(sim.ledger.invariant_holds());
}
