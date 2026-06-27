#![no_std]

#[cfg(test)]
mod tests {
    use anchorpoint_amm::{AMMClient, AMM};
    use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, String};
    use sep41_token::{TokenContract, TokenContractClient};

    // Fails CI if gas increases beyond baseline + ~10% (adjust baseline as needed)
    const MAX_CPU: u64 = 50_000_000;
    const MAX_MEM: u64 = 10_000_000;

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
}
