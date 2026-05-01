#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, Vec,
    };

    /// A mock receiver contract for testing successful flash loans.
    #[contract]
    pub struct MockReceiverSuccess;

    #[contractimpl]
    impl MockReceiverSuccess {
        pub fn execute_loan(env: Env, token: Address, amount: i128, fee: i128) {
            let token_client = TokenClient::new(&env, &token);
            let total_due = amount + fee;

            // Transfer back the amount + fee to the provider
            token_client.transfer(
                &env.current_contract_address(),
                &env.storage()
                    .instance()
                    .get::<_, Address>(&symbol_short!("provider"))
                    .unwrap(),
                &total_due,
            );
        }

        pub fn set_provider(env: Env, provider: Address) {
            env.storage()
                .instance()
                .set(&symbol_short!("provider"), &provider);
        }
    }

    /// A mock receiver contract for testing failed flash loans.
    #[contract]
    pub struct MockReceiverFailure;

    #[contractimpl]
    impl MockReceiverFailure {
        pub fn execute_loan(_env: Env, _token: Address, _amount: i128, _fee: i128) {
            // Do nothing, return nothing
        }
    }

    /// A mock receiver contract for testing successful batch flash loans.
    #[contract]
    pub struct MockBatchReceiverSuccess;

    #[contractimpl]
    impl MockBatchReceiverSuccess {
        pub fn execute_batch_loan(env: Env, loans: Vec<LoanDetail>) {
            let provider = env
                .storage()
                .instance()
                .get::<_, Address>(&symbol_short!("provider"))
                .unwrap();

            for i in 0..loans.len() {
                let loan = loans.get(i).unwrap();
                let token_client = TokenClient::new(&env, &loan.token);
                let total_due = loan.amount + loan.fee;

                // Transfer back the amount + fee to the provider
                token_client.transfer(&env.current_contract_address(), &provider, &total_due);
            }
        }

        pub fn set_provider(env: Env, provider: Address) {
            env.storage()
                .instance()
                .set(&symbol_short!("provider"), &provider);
        }
    }

    /// A mock receiver contract for testing failed batch flash loans.
    #[contract]
    pub struct MockBatchReceiverFailure;

    #[contractimpl]
    impl MockBatchReceiverFailure {
        pub fn execute_batch_loan(_env: Env, _loans: Vec<LoanDetail>) {
            // Do nothing, return nothing
        }
    }

    /// A mock receiver that partially repays batch loans.
    #[contract]
    pub struct MockBatchReceiverPartialRepayment;

    #[contractimpl]
    impl MockBatchReceiverPartialRepayment {
        pub fn execute_batch_loan(env: Env, loans: Vec<LoanDetail>) {
            let provider = env
                .storage()
                .instance()
                .get::<_, Address>(&symbol_short!("provider"))
                .unwrap();

            // Only repay the first loan
            if loans.len() > 0 {
                let loan = loans.get(0).unwrap();
                let token_client = TokenClient::new(&env, &loan.token);
                let total_due = loan.amount + loan.fee;
                token_client.transfer(&env.current_contract_address(), &provider, &total_due);
            }
        }

        pub fn set_provider(env: Env, provider: Address) {
            env.storage()
                .instance()
                .set(&symbol_short!("provider"), &provider);
        }
    }

    fn setup(env: &Env) -> (Address, Address, Address, Address) {
        env.mock_all_auths();

        let admin = Address::generate(env);
        let provider_id = env.register_contract(None, FlashLoanProvider);
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

        // Mint tokens to the provider
        let sac = StellarAssetClient::new(env, &token_id);
        sac.mint(&provider_id, &1_000_000);

        (provider_id, token_id, admin, admin.clone())
    }

    fn setup_multiple_tokens(env: &Env, count: u32) -> (Address, Vec<Address>, Address) {
        env.mock_all_auths();

        let admin = Address::generate(env);
        let provider_id = env.register_contract(None, FlashLoanProvider);

        let mut token_ids = Vec::new(env);
        for _ in 0..count {
            let token_id = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();
            let sac = StellarAssetClient::new(env, &token_id);
            sac.mint(&provider_id, &1_000_000);
            token_ids.push_back(token_id);
        }

        (provider_id, token_ids, admin)
    }

    #[test]
    fn test_flash_loan_success() {
        let env = Env::default();
        let (provider_id, token_id, _admin, _) = setup(&env);

        let receiver_id = env.register_contract(None, MockReceiverSuccess);
        let receiver_client = MockReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        let amount = 100_000;
        let fee = amount * 5 / 10000;

        provider_client.flash_loan(&receiver_id, &token_id, &amount);

        // Check provider balance: should be initial + fee
        let token_client = TokenClient::new(&env, &token_id);
        assert_eq!(token_client.balance(&provider_id), 1_000_000 + fee);
    }

    #[test]
    #[should_panic(expected = "Flash loan not repaid with fee")]
    fn test_flash_loan_failure() {
        let env = Env::default();
        let (provider_id, token_id, _admin, _) = setup(&env);

        let receiver_id = env.register_contract(None, MockReceiverFailure);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        provider_client.flash_loan(&receiver_id, &token_id, &100_000);
    }

    #[test]
    fn test_set_fee_bps() {
        let env = Env::default();
        let (provider_id, _token_id, _admin, _) = setup(&env);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        // Default fee is 5 bps
        assert_eq!(provider_client.get_fee_bps(), 5);

        // Set new fee
        provider_client.set_fee_bps(&10);
        assert_eq!(provider_client.get_fee_bps(), 10);
    }

    #[test]
    #[should_panic(expected = "fee cannot exceed 100%")]
    fn test_set_fee_bps_too_high() {
        let env = Env::default();
        let (provider_id, _token_id, _admin, _) = setup(&env);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        provider_client.set_fee_bps(&10001); // 100.01%
    }

    #[test]
    fn test_flash_loan_with_custom_fee() {
        let env = Env::default();
        let (provider_id, token_id, _admin, _) = setup(&env);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        provider_client.set_fee_bps(&10); // 0.10%

        let receiver_id = env.register_contract(None, MockReceiverSuccess);
        let receiver_client = MockReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let amount = 100_000;
        let fee = amount * 10 / 10000; // 0.10%

        provider_client.flash_loan(&receiver_id, &token_id, &amount);

        let token_client = TokenClient::new(&env, &token_id);
        assert_eq!(token_client.balance(&provider_id), 1_000_000 + fee);
    }

    #[test]
    fn test_flash_loan_batch_success() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 3);

        let receiver_id = env.register_contract(None, MockBatchReceiverSuccess);
        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        // Create batch loan request
        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000));
        loans.push_back((token_ids.get(1).unwrap(), 50_000));
        loans.push_back((token_ids.get(2).unwrap(), 25_000));

        let fee_bps = 5;
        let fee_1 = 100_000 * fee_bps / 10000;
        let fee_2 = 50_000 * fee_bps / 10000;
        let fee_3 = 25_000 * fee_bps / 10000;

        provider_client.flash_loan_batch(&receiver_id, &loans);

        // Check provider balances: should be initial + fee for each token
        let token_client_1 = TokenClient::new(&env, token_ids.get(0).unwrap());
        let token_client_2 = TokenClient::new(&env, token_ids.get(1).unwrap());
        let token_client_3 = TokenClient::new(&env, token_ids.get(2).unwrap());

        assert_eq!(token_client_1.balance(&provider_id), 1_000_000 + fee_1);
        assert_eq!(token_client_2.balance(&provider_id), 1_000_000 + fee_2);
        assert_eq!(token_client_3.balance(&provider_id), 1_000_000 + fee_3);
    }

    #[test]
    fn test_flash_loan_batch_single_asset() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 1);

        let receiver_id = env.register_contract(None, MockBatchReceiverSuccess);
        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000));

        let fee = 100_000 * 5 / 10000;

        provider_client.flash_loan_batch(&receiver_id, &loans);

        let token_client = TokenClient::new(&env, token_ids.get(0).unwrap());
        assert_eq!(token_client.balance(&provider_id), 1_000_000 + fee);
    }

    #[test]
    #[should_panic(expected = "cannot flash loan zero assets")]
    fn test_flash_loan_batch_empty() {
        let env = Env::default();
        let (provider_id, _token_ids, _admin) = setup_multiple_tokens(&env, 1);

        let receiver_id = env.register_contract(None, MockBatchReceiverSuccess);
        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        let loans = Vec::new(&env);
        provider_client.flash_loan_batch(&receiver_id, &loans);
    }

    #[test]
    #[should_panic(expected = "Flash loan not repaid")]
    fn test_flash_loan_batch_failure() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 2);

        let receiver_id = env.register_contract(None, MockBatchReceiverFailure);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000));
        loans.push_back((token_ids.get(1).unwrap(), 50_000));

        provider_client.flash_loan_batch(&receiver_id, &loans);
    }

    #[test]
    #[should_panic(expected = "Flash loan not repaid")]
    fn test_flash_loan_batch_partial_repayment() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 2);

        let receiver_id = env.register_contract(None, MockBatchReceiverPartialRepayment);
        let receiver_client = MockBatchReceiverPartialRepaymentClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000));
        loans.push_back((token_ids.get(1).unwrap(), 50_000));

        provider_client.flash_loan_batch(&receiver_id, &loans);
    }

    #[test]
    fn test_flash_loan_batch_with_custom_fee() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 2);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        provider_client.set_fee_bps(&15); // 0.15%

        let receiver_id = env.register_contract(None, MockBatchReceiverSuccess);
        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000));
        loans.push_back((token_ids.get(1).unwrap(), 50_000));

        let fee_bps = 15;
        let fee_1 = 100_000 * fee_bps / 10000;
        let fee_2 = 50_000 * fee_bps / 10000;

        provider_client.flash_loan_batch(&receiver_id, &loans);

        let token_client_1 = TokenClient::new(&env, token_ids.get(0).unwrap());
        let token_client_2 = TokenClient::new(&env, token_ids.get(1).unwrap());

        assert_eq!(token_client_1.balance(&provider_id), 1_000_000 + fee_1);
        assert_eq!(token_client_2.balance(&provider_id), 1_000_000 + fee_2);
    }

    #[test]
    fn test_flash_loan_batch_large_scale() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 5);

        let receiver_id = env.register_contract(None, MockBatchReceiverSuccess);
        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        let mut loans = Vec::new(&env);
        for i in 0..5 {
            loans.push_back((token_ids.get(i).unwrap(), (i + 1) as i128 * 10_000));
        }

        provider_client.flash_loan_batch(&receiver_id, &loans);

        let fee_bps = 5;
        for i in 0..5 {
            let amount = (i + 1) as i128 * 10_000;
            let fee = amount * fee_bps / 10000;
            let token_client = TokenClient::new(&env, token_ids.get(i).unwrap());
            assert_eq!(token_client.balance(&provider_id), 1_000_000 + fee);
        }
    }
}
