#![no_std]

pub use anchorpoint_amm::{AMM, AMMClient};
pub use sep41_token::{TokenContract, TokenContractClient};
pub use staking::{StakingContract, StakingContractClient};
pub use staking::snapshot::{SnapshotStaking, SnapshotStakingClient};

#[cfg(test)]
#[allow(deprecated)]
mod tests {
    extern crate std;

    use anchorpoint_amm::{AMMClient, AMM};
    use sep41_token::{TokenContract, TokenContractClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env, String,
    };
    use staking::{StakingContract, StakingContractClient};
    use staking::snapshot::{SnapshotStaking, SnapshotStakingClient};

    // Fails CI if gas increases beyond baseline + ~10% (adjust baseline as needed)
    const MAX_CPU: u64 = 50_000_000;
    const MAX_MEM: u64 = 10_000_000;

    fn measure_stake_and_claim_epochs(epochs: u32) -> (u64, u64) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();
        let token_client = StellarAssetClient::new(&env, &token);
        token_client.mint(&user, &101_000);

        let staking_id = env.register(StakingContract, ());
        let staking_client = StakingContractClient::new(&env, &staking_id);
        staking_client.initialize(&admin, &token, &10_000_000, &0);
        token_client.mint(&staking_id, &1_000_000);

        env.ledger().with_mut(|ledger| ledger.timestamp = 1);
        staking_client.stake(&user, &1_000, &0);

        let start_cpu = env.budget().cpu_instruction_cost();
        let start_mem = env.budget().memory_bytes_cost();
        for _ in 0..epochs {
            env.ledger().with_mut(|ledger| ledger.timestamp += 1);
            staking_client.stake(&user, &1_000, &0);
            staking_client.claim_rewards(&user);
        }

        (
            env.budget().cpu_instruction_cost() - start_cpu,
            env.budget().memory_bytes_cost() - start_mem,
        )
    }

    #[test]
    fn benchmark_stake_and_claim_n_epochs() {
        for epochs in [1, 10, 100] {
            let (cpu_used, mem_used) = measure_stake_and_claim_epochs(epochs);
            std::println!(
                "BENCH stake_and_claim_n_epochs n={epochs} cpu={cpu_used} mem={mem_used}"
            );
            assert!(cpu_used > 0);
            assert!(mem_used > 0);
        }
    }

    #[test]
    fn benchmark_snapshot_weight_1000_stakers() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SnapshotStaking, ());
        let client = SnapshotStakingClient::new(&env, &contract_id);
        client.initialize();

        let stakers: std::vec::Vec<Address> = (0..1_000)
            .map(|_| Address::generate(&env))
            .collect();
        for staker in &stakers {
            client.stake(staker, &100);
        }
        client.advance_epoch();

        let start_cpu = env.budget().cpu_instruction_cost();
        let start_mem = env.budget().memory_bytes_cost();
        let snapshot_weight: i128 = stakers
            .iter()
            .map(|staker| client.balance_at(staker, &0))
            .sum();
        let cpu_used = env.budget().cpu_instruction_cost() - start_cpu;
        let mem_used = env.budget().memory_bytes_cost() - start_mem;

        std::println!(
            "BENCH snapshot_weight stakers=1000 weight={snapshot_weight} cpu={cpu_used} mem={mem_used}"
        );
        assert_eq!(snapshot_weight, 100_000);
        assert!(cpu_used > 0);
        assert!(mem_used > 0);
    }

    #[test]
    fn benchmark_amm_deposit_and_swap() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let token_a_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_b_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_a = token_a_contract.address();
        let token_b = token_b_contract.address();

        let token_a_client = StellarAssetClient::new(&env, &token_a);
        let token_b_client = StellarAssetClient::new(&env, &token_b);

        token_a_client.mint(&user, &1000);
        token_b_client.mint(&user, &1000);

        let amm_id = env.register(AMM, ());
        let amm_client = AMMClient::new(&env, &amm_id);

        let start_cpu = env.budget().cpu_instruction_cost();
        let start_mem = env.budget().memory_bytes_cost();

        amm_client.initialize(&admin, &token_a, &token_b);

        let cpu_used = env.budget().cpu_instruction_cost() - start_cpu;
        let mem_used = env.budget().memory_bytes_cost() - start_mem;

        // In a real framework, we'd log this or compare with previous runs exactly
        assert!(cpu_used < MAX_CPU, "AMM initialize CPU regression!");
        assert!(mem_used < MAX_MEM, "AMM initialize MEM regression!");

        let _shares = amm_client.deposit(&user, &1000, &1000);

        let deposit_cpu_used = env.budget().cpu_instruction_cost() - cpu_used - start_cpu;
        assert!(deposit_cpu_used < MAX_CPU, "AMM deposit CPU regression!");
    }

    #[test]
    fn benchmark_token_transfer() {
        let env = Env::default();
        env.mock_all_auths();

        let id = env.register(TokenContract, ());
        let client = TokenContractClient::new(&env, &id);
        let admin = Address::generate(&env);

        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "AnchorToken"),
            &String::from_str(&env, "ANCT"),
        );

        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        client.mint(&user1, &1, &1000);

        let start_cpu = env.budget().cpu_instruction_cost();
        let start_mem = env.budget().memory_bytes_cost();

        client.transfer(&user1, &user2, &1, &500);

        let cpu_used = env.budget().cpu_instruction_cost() - start_cpu;
        let mem_used = env.budget().memory_bytes_cost() - start_mem;

        assert!(cpu_used < MAX_CPU, "Token transfer CPU regression!");
        assert!(mem_used < MAX_MEM, "Token transfer MEM regression!");
    }

    #[test]
    fn benchmark_amm_swap() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let token_a_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_b_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_a = token_a_contract.address();
        let token_b = token_b_contract.address();

        let token_a_client = StellarAssetClient::new(&env, &token_a);
        let token_b_client = StellarAssetClient::new(&env, &token_b);

        token_a_client.mint(&user, &1000);
        token_b_client.mint(&user, &1000);

        let amm_id = env.register(AMM, ());
        let amm_client = AMMClient::new(&env, &amm_id);
        amm_client.initialize(&admin, &token_a, &token_b);
        amm_client.deposit(&user, &1000, &1000);

        let start_cpu = env.budget().cpu_instruction_cost();
        let start_mem = env.budget().memory_bytes_cost();

        amm_client.swap(&user, &token_a, &100, &1);

        let cpu_used = env.budget().cpu_instruction_cost() - start_cpu;
        let mem_used = env.budget().memory_bytes_cost() - start_mem;

        assert!(cpu_used < 5_000_000, "AMM swap CPU regression!");
        assert!(mem_used < MAX_MEM, "AMM swap MEM regression!");
    }

    #[test]
    fn benchmark_staking_stake() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token = token_id.address();

        let token_sac = StellarAssetClient::new(&env, &token);
        token_sac.mint(&user, &1000);

        let stake_id = env.register(StakingContract, ());
        let stake_client = StakingContractClient::new(&env, &stake_id);
        stake_client.initialize(&admin, &token, &100i128, &500i128);

        let start_cpu = env.budget().cpu_instruction_cost();
        let start_mem = env.budget().memory_bytes_cost();

        stake_client.stake(&user, &500, &0);

        let cpu_used = env.budget().cpu_instruction_cost() - start_cpu;
        let mem_used = env.budget().memory_bytes_cost() - start_mem;

        assert!(cpu_used < 5_000_000, "Staking stake CPU regression!");
        assert!(mem_used < MAX_MEM, "Staking stake MEM regression!");
    }
}
