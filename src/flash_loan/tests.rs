#[cfg(test)]
mod tests {
    use crate::{FlashLoanProvider, FlashLoanProviderClient, LoanDetail};
    use soroban_sdk::{
        contract, contractimpl, symbol_short, testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, Vec,
    };

    mod mock_receiver_success {
        use super::*;

        /// A mock receiver contract for testing successful flash loans.
        #[contract]
        pub struct MockReceiverSuccess;

        #[contractimpl]
        impl MockReceiverSuccess {
            pub fn execute_loan(env: Env, token: Address, amount: i128, fee: i128) {
                let token_client = TokenClient::new(&env, &token);
                let total_due = amount + fee;
                env.storage().instance().set(&symbol_short!("last_tok"), &token);
                env.storage().instance().set(&symbol_short!("last_amt"), &amount);
                env.storage().instance().set(&symbol_short!("last_fee"), &fee);

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

            pub fn last_token(env: Env) -> Address {
                env.storage()
                    .instance()
                    .get(&symbol_short!("last_tok"))
                    .unwrap()
            }

            pub fn last_amount(env: Env) -> i128 {
                env.storage()
                    .instance()
                    .get(&symbol_short!("last_amt"))
                    .unwrap()
            }

            pub fn last_fee(env: Env) -> i128 {
                env.storage()
                    .instance()
                    .get(&symbol_short!("last_fee"))
                    .unwrap()
            }
        }
    }
    use mock_receiver_success::{MockReceiverSuccess, MockReceiverSuccessClient};

    mod mock_receiver_failure {
        use super::*;

        /// A mock receiver contract for testing failed flash loans.
        #[contract]
        pub struct MockReceiverFailure;

        #[contractimpl]
        impl MockReceiverFailure {
            pub fn execute_loan(_env: Env, _token: Address, _amount: i128, _fee: i128) {
                // Do nothing, return nothing
            }
        }
    }
    use mock_receiver_failure::MockReceiverFailure;

    mod mock_receiver_principal_only {
        use super::*;

        /// A mock receiver that repays principal but withholds the required fee.
        #[contract]
        pub struct MockReceiverPrincipalOnly;

        #[contractimpl]
        impl MockReceiverPrincipalOnly {
            pub fn execute_loan(env: Env, token: Address, amount: i128, _fee: i128) {
                let token_client = TokenClient::new(&env, &token);
                token_client.transfer(
                    &env.current_contract_address(),
                    &env.storage()
                        .instance()
                        .get::<_, Address>(&symbol_short!("provider"))
                        .unwrap(),
                    &amount,
                );
            }

            pub fn set_provider(env: Env, provider: Address) {
                env.storage()
                    .instance()
                    .set(&symbol_short!("provider"), &provider);
            }
        }
    }
    use mock_receiver_principal_only::{
        MockReceiverPrincipalOnly, MockReceiverPrincipalOnlyClient,
    };

    mod mock_batch_receiver_success {
        use super::*;

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
                let mut total_amount = 0_i128;
                let mut total_fee = 0_i128;

                for i in 0..loans.len() {
                    let loan = loans.get(i).unwrap();
                    let token_client = TokenClient::new(&env, &loan.token);
                    let total_due = loan.amount + loan.fee;
                    total_amount += loan.amount;
                    total_fee += loan.fee;

                    // Transfer back the amount + fee to the provider
                    token_client.transfer(&env.current_contract_address(), &provider, &total_due);
                }

                env.storage()
                    .instance()
                    .set(&symbol_short!("batchcnt"), &loans.len());
                env.storage()
                    .instance()
                    .set(&symbol_short!("sum_amt"), &total_amount);
                env.storage()
                    .instance()
                    .set(&symbol_short!("sum_fee"), &total_fee);
            }

            pub fn set_provider(env: Env, provider: Address) {
                env.storage()
                    .instance()
                    .set(&symbol_short!("provider"), &provider);
            }

            pub fn last_batch_count(env: Env) -> u32 {
                env.storage()
                    .instance()
                    .get(&symbol_short!("batchcnt"))
                    .unwrap()
            }

            pub fn last_batch_amount(env: Env) -> i128 {
                env.storage()
                    .instance()
                    .get(&symbol_short!("sum_amt"))
                    .unwrap()
            }

            pub fn last_batch_fee(env: Env) -> i128 {
                env.storage()
                    .instance()
                    .get(&symbol_short!("sum_fee"))
                    .unwrap()
            }
        }
    }
    use mock_batch_receiver_success::{MockBatchReceiverSuccess, MockBatchReceiverSuccessClient};

    mod mock_batch_receiver_failure {
        use super::*;

        /// A mock receiver contract for testing failed batch flash loans.
        #[contract]
        pub struct MockBatchReceiverFailure;

        #[contractimpl]
        impl MockBatchReceiverFailure {
            pub fn execute_batch_loan(_env: Env, _loans: Vec<LoanDetail>) {
                // Do nothing, return nothing
            }
        }
    }
    use mock_batch_receiver_failure::MockBatchReceiverFailure;

    mod mock_batch_receiver_partial_repayment {
        use super::*;

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
    }
    use mock_batch_receiver_partial_repayment::{
        MockBatchReceiverPartialRepayment, MockBatchReceiverPartialRepaymentClient,
    };

    mod mock_batch_receiver_duplicate_underpay {
        use super::*;

        /// A duplicate-token receiver that repays all principal but only the largest fee.
        #[contract]
        pub struct MockBatchReceiverDuplicateUnderpay;

        #[contractimpl]
        impl MockBatchReceiverDuplicateUnderpay {
            pub fn execute_batch_loan(env: Env, loans: Vec<LoanDetail>) {
                let provider = env
                    .storage()
                    .instance()
                    .get::<_, Address>(&symbol_short!("provider"))
                    .unwrap();

                let mut total_amount = 0_i128;
                let mut largest_fee = 0_i128;
                let first_loan = loans.get(0).unwrap();

                for i in 0..loans.len() {
                    let loan = loans.get(i).unwrap();
                    total_amount += loan.amount;
                    if loan.fee > largest_fee {
                        largest_fee = loan.fee;
                    }
                }

                let token_client = TokenClient::new(&env, &first_loan.token);
                token_client.transfer(
                    &env.current_contract_address(),
                    &provider,
                    &(total_amount + largest_fee),
                );
            }

            pub fn set_provider(env: Env, provider: Address) {
                env.storage()
                    .instance()
                    .set(&symbol_short!("provider"), &provider);
            }
        }
    }
    use mock_batch_receiver_duplicate_underpay::{
        MockBatchReceiverDuplicateUnderpay, MockBatchReceiverDuplicateUnderpayClient,
    };

    fn fee_for(amount: i128, fee_bps: u32) -> i128 {
        amount * fee_bps as i128 / 10_000
    }

    fn mint_to(env: &Env, token: &Address, to: &Address, amount: i128) {
        if amount > 0 {
            StellarAssetClient::new(env, token).mint(to, &amount);
        }
    }

    fn fund_receiver_fee(
        env: &Env,
        token: &Address,
        receiver: &Address,
        amount: i128,
        fee_bps: u32,
    ) -> i128 {
        let fee = fee_for(amount, fee_bps);
        mint_to(env, token, receiver, fee);
        fee
    }

    fn fund_batch_receiver_fees(
        env: &Env,
        loans: &Vec<(Address, i128)>,
        receiver: &Address,
        fee_bps: u32,
    ) {
        for i in 0..loans.len() {
            let (token, amount) = loans.get(i).unwrap();
            mint_to(env, &token, receiver, fee_for(amount, fee_bps));
        }
    }

    fn balance(env: &Env, token: &Address, account: &Address) -> i128 {
        TokenClient::new(env, token).balance(account)
    }

    fn setup(env: &Env) -> (Address, Address, Address, Address) {
        env.mock_all_auths();

        let admin = Address::generate(env);
        let provider_id = env.register(FlashLoanProvider, ());
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

        // Mint tokens to the provider
        let sac = StellarAssetClient::new(env, &token_id);
        sac.mint(&provider_id, &1_000_000);

        (provider_id, token_id, admin.clone(), admin)
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

    #[test]
    fn test_flash_loan_success() {
        let env = Env::default();
        let (provider_id, token_id, _admin, _) = setup(&env);

        let receiver_id = env.register(MockReceiverSuccess, ());
        let receiver_client = MockReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        let amount = 100_000;
        let fee = fund_receiver_fee(&env, &token_id, &receiver_id, amount, 5);

        provider_client.flash_loan(&receiver_id, &token_id, &amount);

        // Check provider balance: should be initial + fee
        assert_eq!(balance(&env, &token_id, &provider_id), 1_000_000 + fee);
        assert_eq!(receiver_client.last_token(), token_id);
        assert_eq!(receiver_client.last_amount(), amount);
        assert_eq!(receiver_client.last_fee(), fee);
    }

    #[test]
    #[should_panic(expected = "Flash loan not repaid with fee")]
    fn test_flash_loan_failure() {
        let env = Env::default();
        let (provider_id, token_id, _admin, _) = setup(&env);

        let receiver_id = env.register(MockReceiverFailure, ());

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        provider_client.flash_loan(&receiver_id, &token_id, &100_000);
    }

    #[test]
    #[should_panic(expected = "Flash loan not repaid with fee")]
    fn test_flash_loan_principal_only_repayment_fails() {
        let env = Env::default();
        let (provider_id, token_id, _admin, _) = setup(&env);

        let receiver_id = env.register(MockReceiverPrincipalOnly, ());
        let receiver_client = MockReceiverPrincipalOnlyClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

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

        let receiver_id = env.register(MockReceiverSuccess, ());
        let receiver_client = MockReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let amount = 100_000;
        let fee = fund_receiver_fee(&env, &token_id, &receiver_id, amount, 10);

        provider_client.flash_loan(&receiver_id, &token_id, &amount);

        assert_eq!(balance(&env, &token_id, &provider_id), 1_000_000 + fee);
        assert_eq!(receiver_client.last_fee(), fee);
    }

    #[test]
    fn test_flash_loan_batch_success() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 3);

        let receiver_id = env.register(MockBatchReceiverSuccess, ());
        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        // Create batch loan request
        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000));
        loans.push_back((token_ids.get(1).unwrap(), 50_000));
        loans.push_back((token_ids.get(2).unwrap(), 25_000));

        let fee_bps = 5;
        let fee_1 = fee_for(100_000, fee_bps);
        let fee_2 = fee_for(50_000, fee_bps);
        let fee_3 = fee_for(25_000, fee_bps);
        fund_batch_receiver_fees(&env, &loans, &receiver_id, fee_bps);

        provider_client.flash_loan_batch(&receiver_id, &loans);

        // Check provider balances: should be initial + fee for each token
        assert_eq!(
            balance(&env, &token_ids.get(0).unwrap(), &provider_id),
            1_000_000 + fee_1
        );
        assert_eq!(
            balance(&env, &token_ids.get(1).unwrap(), &provider_id),
            1_000_000 + fee_2
        );
        assert_eq!(
            balance(&env, &token_ids.get(2).unwrap(), &provider_id),
            1_000_000 + fee_3
        );
        assert_eq!(receiver_client.last_batch_count(), 3);
        assert_eq!(receiver_client.last_batch_amount(), 175_000);
        assert_eq!(receiver_client.last_batch_fee(), fee_1 + fee_2 + fee_3);
    }

    #[test]
    fn test_flash_loan_batch_single_asset() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 1);

        let receiver_id = env.register(MockBatchReceiverSuccess, ());
        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000));

        let fee = fee_for(100_000, 5);
        fund_batch_receiver_fees(&env, &loans, &receiver_id, 5);

        provider_client.flash_loan_batch(&receiver_id, &loans);

        assert_eq!(
            balance(&env, &token_ids.get(0).unwrap(), &provider_id),
            1_000_000 + fee
        );
    }

    #[test]
    #[should_panic(expected = "cannot flash loan zero assets")]
    fn test_flash_loan_batch_empty() {
        let env = Env::default();
        let (provider_id, _token_ids, _admin) = setup_multiple_tokens(&env, 1);

        let receiver_id = env.register(MockBatchReceiverSuccess, ());
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
        loans.push_back((token_ids.get(0).unwrap(), 100_000));
        loans.push_back((token_ids.get(1).unwrap(), 50_000));
        fund_batch_receiver_fees(&env, &loans, &receiver_id, 5);

        provider_client.flash_loan_batch(&receiver_id, &loans);
    }

    #[test]
    #[should_panic(expected = "Flash loan not repaid")]
    fn test_flash_loan_batch_partial_repayment() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 2);

        let receiver_id = env.register(MockBatchReceiverPartialRepayment, ());
        let receiver_client = MockBatchReceiverPartialRepaymentClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000));
        loans.push_back((token_ids.get(1).unwrap(), 50_000));
        fund_batch_receiver_fees(&env, &loans, &receiver_id, 5);

        provider_client.flash_loan_batch(&receiver_id, &loans);
    }

    #[test]
    fn test_flash_loan_batch_with_custom_fee() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 2);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        provider_client.set_fee_bps(&15); // 0.15%

        let receiver_id = env.register(MockBatchReceiverSuccess, ());
        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let mut loans = Vec::new(&env);
        loans.push_back((token_ids.get(0).unwrap(), 100_000));
        loans.push_back((token_ids.get(1).unwrap(), 50_000));

        let fee_bps = 15;
        let fee_1 = fee_for(100_000, fee_bps);
        let fee_2 = fee_for(50_000, fee_bps);
        fund_batch_receiver_fees(&env, &loans, &receiver_id, fee_bps);

        provider_client.flash_loan_batch(&receiver_id, &loans);

        assert_eq!(
            balance(&env, &token_ids.get(0).unwrap(), &provider_id),
            1_000_000 + fee_1
        );
        assert_eq!(
            balance(&env, &token_ids.get(1).unwrap(), &provider_id),
            1_000_000 + fee_2
        );
    }

    #[test]
    fn test_flash_loan_batch_large_scale() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 5);

        let receiver_id = env.register(MockBatchReceiverSuccess, ());
        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);

        let mut loans = Vec::new(&env);
        for i in 0..5 {
            loans.push_back((token_ids.get(i).unwrap(), (i + 1) as i128 * 10_000));
        }
        fund_batch_receiver_fees(&env, &loans, &receiver_id, 5);

        provider_client.flash_loan_batch(&receiver_id, &loans);

        let fee_bps = 5;
        for i in 0..5 {
            let amount = (i + 1) as i128 * 10_000;
            let fee = fee_for(amount, fee_bps);
            assert_eq!(
                balance(&env, &token_ids.get(i).unwrap(), &provider_id),
                1_000_000 + fee
            );
        }
    }

    #[test]
    fn test_flash_loan_batch_duplicate_token_success_accumulates_fees() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 1);
        let token_id = token_ids.get(0).unwrap();

        let receiver_id = env.register(MockBatchReceiverSuccess, ());
        let receiver_client = MockBatchReceiverSuccessClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        let mut loans = Vec::new(&env);
        loans.push_back((token_id.clone(), 100_000));
        loans.push_back((token_id.clone(), 50_000));

        let fee_1 = fee_for(100_000, 5);
        let fee_2 = fee_for(50_000, 5);
        fund_batch_receiver_fees(&env, &loans, &receiver_id, 5);

        provider_client.flash_loan_batch(&receiver_id, &loans);

        assert_eq!(
            balance(&env, &token_id, &provider_id),
            1_000_000 + fee_1 + fee_2
        );
        assert_eq!(receiver_client.last_batch_count(), 2);
        assert_eq!(receiver_client.last_batch_fee(), fee_1 + fee_2);
    }

    #[test]
    #[should_panic(expected = "Flash loan not repaid")]
    fn test_flash_loan_batch_rejects_duplicate_token_fee_underpayment() {
        let env = Env::default();
        let (provider_id, token_ids, _admin) = setup_multiple_tokens(&env, 1);
        let token_id = token_ids.get(0).unwrap();

        let receiver_id = env.register(MockBatchReceiverDuplicateUnderpay, ());
        let receiver_client = MockBatchReceiverDuplicateUnderpayClient::new(&env, &receiver_id);
        receiver_client.set_provider(&provider_id);

        let provider_client = FlashLoanProviderClient::new(&env, &provider_id);
        let mut loans = Vec::new(&env);
        loans.push_back((token_id.clone(), 100_000));
        loans.push_back((token_id, 50_000));

        mint_to(
            &env,
            &token_ids.get(0).unwrap(),
            &receiver_id,
            fee_for(100_000, 5),
        );

        provider_client.flash_loan_batch(&receiver_id, &loans);
    }
}
