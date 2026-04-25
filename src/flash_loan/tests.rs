#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env,
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
}
