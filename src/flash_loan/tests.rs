#[cfg(test)]
mod tests {
    use crate::{FlashLoanProvider, FlashLoanProviderClient};
    use soroban_sdk::{
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, Vec,
    };

    // ── Mock contracts ────────────────────────────────────────────────────────
    // Each mock lives in its own module to avoid symbol collisions from
    // the #[contractimpl] macro generating global identifiers.

    mod mock_receiver_success {
        use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env};

        #[contract]
        pub struct MockReceiverSuccess;

        #[contractimpl]
        impl MockReceiverSuccess {
            pub fn execute_loan(env: Env, token: Address, amount: i128, fee: i128) {
                let token_client = token::Client::new(&env, &token);
                let total_due = amount + fee;
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
    }
    pub use mock_receiver_success::{MockReceiverSuccess, MockReceiverSuccessClient};

    mod mock_receiver_failure {
        use soroban_sdk::{contract, contractimpl, Address, Env};

        #[contract]
        pub struct MockReceiverFailure;

        #[contractimpl]
        impl MockReceiverFailure {
            pub fn execute_loan(_env: Env, _token: Address, _amount: i128, _fee: i128) {
                // Do nothing — loan will not be repaid.
            }
        }
    }
    pub use mock_receiver_failure::MockReceiverFailure;

    mod mock_receiver_reentrant {
        use crate::FlashLoanProviderClient;
        use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

        #[contract]
        pub struct MockReceiverReentrant;

        #[contractimpl]
        impl MockReceiverReentrant {
            pub fn execute_loan(env: Env, _token: Address, _amount: i128, _fee: i128) {
                let provider = env
                    .storage()
                    .instance()
                    .get::<_, Address>(&symbol_short!("provider"))
                    .unwrap();
                let token = env
                    .storage()
                    .instance()
                    .get::<_, Address>(&symbol_short!("token"))
                    .unwrap();
                let provider_client = FlashLoanProviderClient::new(&env, &provider);
                provider_client.flash_loan(&env.current_contract_address(), &token, &1);
            }

            pub fn set_reentry_target(env: Env, provider: Address, token: Address) {
                env.storage()
                    .instance()
                    .set(&symbol_short!("provider"), &provider);
                env.storage()
                    .instance()
                    .set(&symbol_short!("token"), &token);
            }
        }
    }
    pub use mock_receiver_reentrant::{MockReceiverReentrant, MockReceiverReentrantClient};

    mod mock_batch_receiver_success {
        use crate::LoanDetail;
        use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, Vec};

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
                    let token_client = token::Client::new(&env, &loan.token);
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
    }
    pub use mock_batch_receiver_success::{
        MockBatchReceiverSuccess, MockBatchReceiverSuccessClient,
    };

    mod mock_batch_receiver_failure {
        use crate::LoanDetail;
        use soroban_sdk::{contract, contractimpl, Env, Vec};

        #[contract]
        pub struct MockBatchReceiverFailure;

        #[contractimpl]
        impl MockBatchReceiverFailure {
            pub fn execute_batch_loan(_env: Env, _loans: Vec<LoanDetail>) {
                // Do nothing — loans will not be repaid.
            }
        }
    }
    pub use mock_batch_receiver_failure::MockBatchReceiverFailure;

    mod mock_batch_receiver_reentrant {
        use crate::{FlashLoanProviderClient, LoanDetail};
        use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Vec};

        #[contract]
        pub struct MockBatchReceiverReentrant;

        #[contractimpl]
        impl MockBatchReceiverReentrant {
            pub fn execute_batch_loan(env: Env, loans: Vec<LoanDetail>) {
                let provider = env
                    .storage()
                    .instance()
                    .get::<_, Address>(&symbol_short!("provider"))
                    .unwrap();
                let token = loans.get(0).unwrap().token;
                let provider_client = FlashLoanProviderClient::new(&env, &provider);
                let reentrant_loans = soroban_sdk::vec![&env, (token, 1_i128)];
                provider_client.flash_loan_batch(&env.current_contract_address(), &reentrant_loans);
            }

            pub fn set_provider(env: Env, provider: Address) {
                env.storage()
                    .instance()
                    .set(&symbol_short!("provider"), &provider);
            }
        }
    }
    pub use mock_batch_receiver_reentrant::{
        MockBatchReceiverReentrant, MockBatchReceiverReentrantClient,
    };

    mod mock_batch_receiver_partial {
        use crate::LoanDetail;
        use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, Vec};

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
                // Only repay the first loan.
                if loans.len() > 0 {
                    let loan = loans.get(0).unwrap();
                    let token_client = token::Client::new(&env, &loan.token);
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
    }
    pub use mock_batch_receiver_partial::{
        MockBatchReceiverPartialRepayment, MockBatchReceiverPartialRepaymentClient,
    };

    // ── Setup helpers ─────────────────────────────────────────────────────────

    /// Mint tokens to both the provider (principal) and the receiver (fee buffer).
    /// The receiver needs to hold enough to repay principal + fee in one transfer.
    fn setup_with_receiver(env: &Env, receiver_id: &Address) -> (Address, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let provider_id = env.register(FlashLoanProvider, ());
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let sac = StellarAssetClient::new(env, &token_id);
        sac.mint(&provider_id, &1_000_000);
        // Give receiver a fee buffer (1 % of 1_000_000 = 10_000 is plenty)
        sac.mint(receiver_id, &10_000);
        (provider_id, token_id, admin)
    }

    fn setup(env: &Env) -> (Address, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let provider_id = env.register(FlashLoanProvider, ());
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let sac = StellarAssetClient::new(env, &token_id);
        sac.mint(&provider_id, &1_000_000);
        (provider_id, token_id, admin)
    }

    fn setup_multiple_tokens(env: &Env, count: u32) -> (Address, Vec<Address>, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let provider_id = env.register(FlashLoanProvider, ());
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

    /// Like setup_multiple_tokens but also mints a fee buffer to `receiver_id`.
    fn setup_multiple_tokens_with_receiver(
        env: &Env,
        count: u32,
        receiver_id: &Address,
    ) -> (Address, Vec<Address>, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let provider_id = env.register(FlashLoanProvider, ());
        let mut token_ids = Vec::new(env);
        for _ in 0..count {
            let token_id = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();
            let sac = StellarAssetClient::new(env, &token_id);
            sac.mint(&provider_id, &1_000_000);
            sac.mint(receiver_id, &10_000); // fee buffer
            token_ids.push_back(token_id);
        }
        (provider_id, token_ids, admin)
    }

    // ── Single-asset flash loan tests ─────────────────────────────────────────

    #[test]
    fn test_flash_loan_success() {
        let env = Env::default();
        let receiver_id = env.register(MockReceiverSuccess, ());
        let (provider_id, token_id, _admin) = setup_with_receiver(&env, &receiver_id);

        let receiver_client = MockReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        let amount = 100_000_i128;
        let fee = amount * 5 / 10_000; // default 5 bps

        provider_client.flash_loan(&receiver_id, &token_id, &amount);

        let token_client = TokenClient::new(&env, &token_id);
        assert_eq!(token_client.balance(&provider_id), 1_000_000 + fee);
    }

    #[test]
    #[should_panic(expected = "Flash loan not repaid with fee")]
    fn test_flash_loan_failure() {
        let env = Env::default();
        let (provider_id, token_id, _admin) = setup(&env);
        let receiver_id = env.register(MockReceiverFailure, ());
        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        provider_client.flash_loan(&receiver_id, &token_id, &100_000);
    }

    #[test]
    #[should_panic(expected = "Contract re-entry is not allowed")]
    fn test_flash_loan_reentrancy_guard_blocks_nested_loan() {
        let env = Env::default();
        let receiver_id = env.register(MockReceiverReentrant, ());
        let (provider_id, token_id, _admin) = setup_with_receiver(&env, &receiver_id);

        let receiver_client = MockReceiverReentrantClient::new(&env, &receiver_id);
        receiver_client.set_reentry_target(&provider_id, &token_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        provider_client.flash_loan(&receiver_id, &token_id, &100_000);
    }

    #[test]
    fn test_set_fee_bps() {
        let env = Env::default();
        let (provider_id, _token_id, _admin) = setup(&env);
        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        assert_eq!(provider_client.get_fee_bps(), 5);
        provider_client.set_fee_bps(&10);
        assert_eq!(provider_client.get_fee_bps(), 10);
    }

    #[test]
    #[should_panic(expected = "fee cannot exceed 100%")]
    fn test_set_fee_bps_too_high() {
        let env = Env::default();
        let (provider_id, _token_id, _admin) = setup(&env);
        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        provider_client.set_fee_bps(&10_001);
    }

    #[test]
    fn test_flash_loan_with_custom_fee() {
        let env = Env::default();
        let receiver_id = env.register(MockReceiverSuccess, ());
        let (provider_id, token_id, _admin) = setup_with_receiver(&env, &receiver_id);
        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        provider_client.set_fee_bps(&10); // 0.10 %

        let receiver_client = MockReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let amount = 100_000_i128;
        let fee = amount * 10 / 10_000;
        provider_client.flash_loan(&receiver_id, &token_id, &amount);

        let token_client = TokenClient::new(&env, &token_id);
        assert_eq!(token_client.balance(&provider_id), 1_000_000 + fee);
    }

    // ── Dynamic fee tier tests ────────────────────────────────────────────────

    #[test]
    fn test_dynamic_fee_tiers() {
        use crate::FeeTier;
        let env = Env::default();
        let (provider_id, _token_id, _admin) = setup(&env);
        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        let tiers = soroban_sdk::vec![
            &env,
            FeeTier {
                volume_threshold: 0,
                fee_bps: 30
            },
            FeeTier {
                volume_threshold: 10_000,
                fee_bps: 20
            },
            FeeTier {
                volume_threshold: 100_000,
                fee_bps: 10
            },
        ];
        provider_client.set_fee_tiers(&tiers);

        assert_eq!(
            provider_client.calculate_fee(&5_000),
            5_000_i128 * 30 / 10_000
        );
        assert_eq!(
            provider_client.calculate_fee(&50_000),
            50_000_i128 * 20 / 10_000
        );
        assert_eq!(
            provider_client.calculate_fee(&200_000),
            200_000_i128 * 10 / 10_000
        );
    }

    #[test]
    fn test_dynamic_fee_flash_loan() {
        use crate::FeeTier;
        let env = Env::default();
        let receiver_id = env.register(MockReceiverSuccess, ());
        let (provider_id, token_id, _admin) = setup_with_receiver(&env, &receiver_id);
        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        let tiers = soroban_sdk::vec![
            &env,
            FeeTier {
                volume_threshold: 0,
                fee_bps: 30
            },
            FeeTier {
                volume_threshold: 10_000,
                fee_bps: 10
            },
        ];
        provider_client.set_fee_tiers(&tiers);

        let receiver_client = MockReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let amount = 100_000_i128;
        let expected_fee = amount * 10 / 10_000; // 10 bps tier
        provider_client.flash_loan(&receiver_id, &token_id, &amount);

        let token_client = TokenClient::new(&env, &token_id);
        assert_eq!(token_client.balance(&provider_id), 1_000_000 + expected_fee);
    }

    // ── Batch flash loan tests ────────────────────────────────────────────────

    #[test]
    fn test_flash_loan_batch_success() {
        let env = Env::default();
        let receiver_id = env.register(MockBatchReceiverSuccess, ());
        let (provider_id, token_ids, _admin) =
            setup_multiple_tokens_with_receiver(&env, 3, &receiver_id);

        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000_i128));
        loans.push_back((token_ids.get(1).unwrap(), 50_000_i128));
        loans.push_back((token_ids.get(2).unwrap(), 25_000_i128));

        let fee_bps = 5_i128;
        let fee_1 = 100_000 * fee_bps / 10_000;
        let fee_2 = 50_000 * fee_bps / 10_000;
        let fee_3 = 25_000 * fee_bps / 10_000;

        provider_client.flash_loan_batch(&receiver_id, &loans);

        let tc1 = TokenClient::new(&env, &token_ids.get(0).unwrap());
        let tc2 = TokenClient::new(&env, &token_ids.get(1).unwrap());
        let tc3 = TokenClient::new(&env, &token_ids.get(2).unwrap());
        assert_eq!(tc1.balance(&provider_id), 1_000_000 + fee_1);
        assert_eq!(tc2.balance(&provider_id), 1_000_000 + fee_2);
        assert_eq!(tc3.balance(&provider_id), 1_000_000 + fee_3);
    }

    #[test]
    fn test_flash_loan_batch_single_asset() {
        let env = Env::default();
        let receiver_id = env.register(MockBatchReceiverSuccess, ());
        let (provider_id, token_ids, _admin) =
            setup_multiple_tokens_with_receiver(&env, 1, &receiver_id);

        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000_i128));

        let fee = 100_000_i128 * 5 / 10_000;
        provider_client.flash_loan_batch(&receiver_id, &loans);

        let tc = TokenClient::new(&env, &token_ids.get(0).unwrap());
        assert_eq!(tc.balance(&provider_id), 1_000_000 + fee);
    }

    #[test]
    #[should_panic(expected = "cannot flash loan zero assets")]
    fn test_flash_loan_batch_empty() {
        let env = Env::default();
        let receiver_id = env.register(MockBatchReceiverSuccess, ());
        let (provider_id, _token_ids, _admin) =
            setup_multiple_tokens_with_receiver(&env, 1, &receiver_id);
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
        let receiver_id = env.register(MockBatchReceiverFailure, ());
        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000_i128));
        loans.push_back((token_ids.get(1).unwrap(), 50_000_i128));
        provider_client.flash_loan_batch(&receiver_id, &loans);
    }

    #[test]
    #[should_panic(expected = "Contract re-entry is not allowed")]
    fn test_flash_loan_batch_reentrancy_guard_blocks_nested_batch() {
        let env = Env::default();
        let receiver_id = env.register(MockBatchReceiverReentrant, ());
        let (provider_id, token_ids, _admin) =
            setup_multiple_tokens_with_receiver(&env, 1, &receiver_id);

        let receiver_client = MockBatchReceiverReentrantClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        let loans = soroban_sdk::vec![&env, (token_ids.get(0).unwrap(), 100_000_i128)];
        provider_client.flash_loan_batch(&receiver_id, &loans);
    }

    #[test]
    #[should_panic(expected = "Flash loan not repaid")]
    fn test_flash_loan_batch_partial_repayment() {
        let env = Env::default();
        let receiver_id = env.register(MockBatchReceiverPartialRepayment, ());
        // Fund receiver so it can repay the first loan's fee, but not the second.
        let (provider_id, token_ids, _admin) =
            setup_multiple_tokens_with_receiver(&env, 2, &receiver_id);

        let receiver_client = MockBatchReceiverPartialRepaymentClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000_i128));
        loans.push_back((token_ids.get(1).unwrap(), 50_000_i128));
        provider_client.flash_loan_batch(&receiver_id, &loans);
    }

    #[test]
    fn test_flash_loan_batch_with_custom_fee() {
        let env = Env::default();
        let receiver_id = env.register(MockBatchReceiverSuccess, ());
        let (provider_id, token_ids, _admin) =
            setup_multiple_tokens_with_receiver(&env, 2, &receiver_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        provider_client.set_fee_bps(&15); // 0.15 %

        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000_i128));
        loans.push_back((token_ids.get(1).unwrap(), 50_000_i128));

        let fee_bps = 15_i128;
        let fee_1 = 100_000 * fee_bps / 10_000;
        let fee_2 = 50_000 * fee_bps / 10_000;
        provider_client.flash_loan_batch(&receiver_id, &loans);

        let tc1 = TokenClient::new(&env, &token_ids.get(0).unwrap());
        let tc2 = TokenClient::new(&env, &token_ids.get(1).unwrap());
        assert_eq!(tc1.balance(&provider_id), 1_000_000 + fee_1);
        assert_eq!(tc2.balance(&provider_id), 1_000_000 + fee_2);
    }

    #[test]
    fn test_flash_loan_batch_large_scale() {
        let env = Env::default();
        let receiver_id = env.register(MockBatchReceiverSuccess, ());
        let (provider_id, token_ids, _admin) =
            setup_multiple_tokens_with_receiver(&env, 5, &receiver_id);

        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        let mut loans = Vec::new(&env);
        for i in 0..5_u32 {
            loans.push_back((token_ids.get(i).unwrap(), (i as i128 + 1) * 10_000));
        }
        provider_client.flash_loan_batch(&receiver_id, &loans);

        let fee_bps = 5_i128;
        for i in 0..5_u32 {
            let amount = (i as i128 + 1) * 10_000;
            let fee = amount * fee_bps / 10_000;
            let tc = TokenClient::new(&env, &token_ids.get(i).unwrap());
            assert_eq!(tc.balance(&provider_id), 1_000_000 + fee);
        }
    }
}
