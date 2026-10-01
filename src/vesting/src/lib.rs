use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

const CLIFF_REACHED: Symbol = symbol_short!("CliffReached");
const SCHEDULE_REVOKED: Symbol = symbol_short!("Revoked");

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VestingStatus {
    Active,
    Revoked,
}

/// Unlock schedule selection.
///
/// `Continuous` releases tokens second-by-second (linear) between the cliff and
/// the end time. `Step(step_duration)` releases tokens in discrete tranches,
/// where `step_duration` is the length of each step in seconds (e.g. 30 days for
/// monthly unlocks). Partial steps never release tokens.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UnlockType {
    Continuous,
    Step(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
    pub beneficiary: Address,
    pub start_time: u64,
    pub cliff_time: u64,
    pub end_time: u64,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub revocable: bool,
    pub status: VestingStatus,
    pub unlock_type: UnlockType,
}

#[contract]
pub struct VestingContract;

#[contractimpl]
impl VestingContract {
    /// Create a new vesting schedule for a beneficiary.
    ///
    /// The schedule must satisfy `start_time <= cliff_time <= end_time`.
    pub fn create_schedule(
        env: Env,
        beneficiary: Address,
        start_time: u64,
        cliff_time: u64,
        end_time: u64,
        total_amount: i128,
        revocable: bool,
        unlock_type: UnlockType,
    ) -> VestingSchedule {
        Self::validate_schedule(start_time, cliff_time, end_time);

        VestingSchedule {
            beneficiary,
            start_time,
            cliff_time,
            end_time,
            total_amount,
            claimed_amount: 0,
            revocable,
            status: VestingStatus::Active,
            unlock_type,
        }
    }

    /// Calculate the amount of tokens vested at `current_timestamp`.
    ///
    /// Returns `0` for any timestamp strictly before the cliff. Once the cliff
    /// is reached, tokens vest according to the schedule's `UnlockType`:
    /// continuously (linear) or in discrete steps where partial steps release
    /// nothing.
    pub fn calculate_vested_amount(
        env: Env,
        schedule: VestingSchedule,
        current_timestamp: u64,
    ) -> i128 {
        Self::validate_schedule(schedule.start_time, schedule.cliff_time, schedule.end_time);

        // Strict cliff enforcement: nothing is claimable before the cliff.
        if current_timestamp < schedule.cliff_time {
            return 0;
        }

        if current_timestamp >= schedule.end_time {
            return schedule.total_amount;
        }

        let elapsed = current_timestamp - schedule.cliff_time;
        let duration = schedule.end_time - schedule.cliff_time;

        if duration == 0 {
            return schedule.total_amount;
        }

        match schedule.unlock_type {
            UnlockType::Continuous => {
                schedule.total_amount * (elapsed as i128) / (duration as i128)
            }
            UnlockType::Step(step_duration) => {
                if step_duration == 0 {
                    return 0;
                }

                // Number of fully completed steps. Floor division ensures a
                // partial step never releases tokens.
                let completed_steps = elapsed / step_duration;
                let total_steps = duration / step_duration;

                if total_steps == 0 {
                    return schedule.total_amount;
                }

                if completed_steps >= total_steps {
                    return schedule.total_amount;
                }

                schedule.total_amount * (completed_steps as i128) / (total_steps as i128)
            }
        }
    }

    /// Claim vested tokens for the beneficiary.
    ///
    /// Emits a `CliffReached` event when the claim happens at or just after the
    /// cliff timestamp (i.e. the first claimable moment).
    pub fn claim(env: Env, schedule: VestingSchedule, current_timestamp: u64) -> i128 {
        Self::validate_schedule(schedule.start_time, schedule.cliff_time, schedule.end_time);

        let vested = Self::calculate_vested_amount(env.clone(), schedule.clone(), current_timestamp);
        let claimable = vested - schedule.claimed_amount;

        if claimable <= 0 {
            return 0;
        }

        // Emit CliffReached when the claim occurs right after the cliff timestamp.
        if current_timestamp >= schedule.cliff_time
            && current_timestamp <= schedule.cliff_time.saturating_add(1)
        {
            env.events().publish(
                (CLIFF_REACHED, schedule.beneficiary.clone()),
                current_timestamp,
            );
        }

        claimable
    }

    /// Revoke an active, revocable vesting schedule.
    ///
    /// The admin must authenticate. Already-vested tokens up to
    /// `current_timestamp` are preserved for the beneficiary (pro-rata refund),
    /// while the remaining unvested tokens are returned to the admin/treasury.
    /// The schedule is marked `Revoked` so no further vesting accrues.
    ///
    /// Returns `(beneficiary_amount, admin_amount)`.
    pub fn revoke_schedule(
        env: Env,
        admin: Address,
        schedule: VestingSchedule,
        current_timestamp: u64,
    ) -> (i128, i128) {
        admin.require_auth();

        assert!(schedule.revocable, "schedule is not revocable");
        assert!(
            schedule.status == VestingStatus::Active,
            "schedule is not active"
        );

        Self::validate_schedule(schedule.start_time, schedule.cliff_time, schedule.end_time);

        let vested = Self::calculate_vested_amount(env.clone(), schedule.clone(), current_timestamp);
        let beneficiary_amount = vested - schedule.claimed_amount;
        let admin_amount = schedule.total_amount - vested;

        env.events().publish(
            (SCHEDULE_REVOKED, schedule.beneficiary.clone()),
            (beneficiary_amount, admin_amount),
        );

        (beneficiary_amount, admin_amount)
    }

    fn validate_schedule(start_time: u64, cliff_time: u64, end_time: u64) {
        assert!(start_time <= cliff_time, "start_time must be <= cliff_time");
        assert!(cliff_time <= end_time, "cliff_time must be <= end_time");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    const DAY: u64 = 86_400;

    fn schedule(env: &Env, start: u64, cliff: u64, end: u64) -> VestingSchedule {
        VestingSchedule {
            beneficiary: Address::generate(env),
            start_time: start,
            cliff_time: cliff,
            end_time: end,
            total_amount: 1_000,
            claimed_amount: 0,
            revocable: true,
            status: VestingStatus::Active,
            unlock_type: UnlockType::Continuous,
        }
    }

    fn step_schedule(env: &Env, start: u64, cliff: u64, end: u64, step: u64) -> VestingSchedule {
        let mut s = schedule(env, start, cliff, end);
        s.unlock_type = UnlockType::Step(step);
        s
    }

    #[test]
    fn test_no_vesting_one_second_before_cliff() {
        let env = Env::default();
        let s = schedule(&env, 0, 100, 200);
        let vested = VestingContract::calculate_vested_amount(env.clone(), s, 99);
        assert_eq!(vested, 0);
    }

    #[test]
    fn test_zero_vesting_exactly_at_cliff() {
        let env = Env::default();
        let s = schedule(&env, 0, 100, 200);
        let vested = VestingContract::calculate_vested_amount(env.clone(), s, 100);
        assert_eq!(vested, 0);
    }

    #[test]
    fn test_vesting_after_cliff() {
        let env = Env::default();
        let s = schedule(&env, 0, 100, 200);
        let vested = VestingContract::calculate_vested_amount(env.clone(), s, 150);
        assert_eq!(vested, 500);
    }

    #[test]
    fn test_full_vesting_at_end() {
        let env = Env::default();
        let s = schedule(&env, 0, 100, 200);
        let vested = VestingContract::calculate_vested_amount(env.clone(), s, 200);
        assert_eq!(vested, 1_000);
    }

    #[test]
    #[should_panic(expected = "start_time must be <= cliff_time")]
    fn test_invalid_schedule_start_after_cliff() {
        let env = Env::default();
        let s = schedule(&env, 150, 100, 200);
        VestingContract::calculate_vested_amount(env.clone(), s, 150);
    }

    #[test]
    #[should_panic(expected = "cliff_time must be <= end_time")]
    fn test_invalid_schedule_cliff_after_end() {
        let env = Env::default();
        let s = schedule(&env, 0, 250, 200);
        VestingContract::calculate_vested_amount(env.clone(), s, 250);
    }

    #[test]
    fn test_revoke_partial_vesting_splits_pro_rata() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let s = schedule(&env, 0, 100, 200);

        // Halfway through the linear vesting window: 500 vested, 500 unvested.
        let (beneficiary_amount, admin_amount) =
            VestingContract::revoke_schedule(env.clone(), admin, s, 150);

        assert_eq!(beneficiary_amount, 500);
        assert_eq!(admin_amount, 500);
    }

    #[test]
    fn test_revoke_before_cliff_returns_all_to_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let s = schedule(&env, 0, 100, 200);

        let (beneficiary_amount, admin_amount) =
            VestingContract::revoke_schedule(env.clone(), admin, s, 50);

        assert_eq!(beneficiary_amount, 0);
        assert_eq!(admin_amount, 1_000);
    }

    #[test]
    fn test_step_unlock_releases_nothing_before_first_step() {
        let env = Env::default();
        // 30-day steps over a 90-day window starting at the cliff.
        let s = step_schedule(&env, 0, 0, 90 * DAY, 30 * DAY);

        // Just before the first full step completes: nothing released.
        let vested = VestingContract::calculate_vested_amount(env.clone(), s.clone(), 30 * DAY - 1);
        assert_eq!(vested, 0);

        // Exactly at the first step boundary: one third released.
        let vested = VestingContract::calculate_vested_amount(env.clone(), s, 30 * DAY);
        assert_eq!(vested, 333);
    }

    #[test]
    fn test_step_unlock_partial_step_does_not_release() {
        let env = Env::default();
        let s = step_schedule(&env, 0, 0, 90 * DAY, 30 * DAY);

        // 45 days in: only the first completed step counts (1/3).
        let vested = VestingContract::calculate_vested_amount(env.clone(), s, 45 * DAY);
        assert_eq!(vested, 333);
    }

    #[test]
    fn test_step_unlock_full_at_end() {
        let env = Env::default();
        let s = step_schedule(&env, 0, 0, 90 * DAY, 30 * DAY);
        let vested = VestingContract::calculate_vested_amount(env.clone(), s, 90 * DAY);
        assert_eq!(vested, 1_000);
    }

    #[test]
    fn test_continuous_vs_step_unlock_differ_midway() {
        let env = Env::default();
        let continuous = schedule(&env, 0, 0, 90 * DAY);
        let step = step_schedule(&env, 0, 0, 90 * DAY, 30 * DAY);

        // At 45 days: continuous has vested half, step has vested one third.
        let continuous_vested =
            VestingContract::calculate_vested_amount(env.clone(), continuous, 45 * DAY);
        let step_vested =
            VestingContract::calculate_vested_amount(env.clone(), step, 45 * DAY);

        assert_eq!(continuous_vested, 500);
        assert_eq!(step_vested, 333);
        assert!(step_vested < continuous_vested);
    }
}
