use anchorpoint_amm::{AMMClient, AMM};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env};

const MAX_SUPPLY: i128 = 1_000_000_000_000_000;

fn setup_pool(
    initial_a: i128,
    initial_b: i128,
) -> (Env, AMMClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let token_a = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_b = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    StellarAssetClient::new(&env, &token_a).mint(&user, &MAX_SUPPLY);
    StellarAssetClient::new(&env, &token_b).mint(&user, &MAX_SUPPLY);

    let contract_id = env.register(AMM, ());
    let client = AMMClient::new(&env, &contract_id);

    if token_a < token_b {
        client.initialize(&admin, &token_a, &token_b);
    } else {
        client.initialize(&admin, &token_b, &token_a);
    }

    client.deposit(&user, &initial_a, &initial_b);

    (env, client, token_a, token_b, user)
}

proptest! {
    #[test]
    fn fuzz_constant_product_never_decreases(
        initial_a in 100_000i128..1_000_000i128,
        initial_b in 100_000i128..1_000_000i128,
        amounts_in in prop::collection::vec(1_000i128..200_000i128, 1..20),
        directions in prop::collection::vec(proptest::bool::ANY, 1..20),
    ) {
        let (_env, client, token_a, token_b, user) = setup_pool(initial_a, initial_b);

        let num_swaps = amounts_in.len().min(directions.len());
        for i in 0..num_swaps {
            let (r_a, r_b) = client.get_reserves();
            let k_before = r_a * r_b;

            let (token_in, _reserve_in) = if directions[i] {
                (token_a.clone(), r_a)
            } else {
                (token_b.clone(), r_b)
            };

            let amount_in = amounts_in[i];

            let (r_a2, r_b2) = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.swap(&user, &token_in, &amount_in, &0);
                client.get_reserves()
            })) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let k_after = r_a2 * r_b2;

            prop_assert!(
                k_after >= k_before,
                "k must not decrease after swap. before={}, after={}", k_before, k_after
            );
            prop_assert!(r_a2 >= 0, "reserve_a must be >= 0, got {}", r_a2);
            prop_assert!(r_b2 >= 0, "reserve_b must be >= 0, got {}", r_b2);
        }
    }

    #[test]
    fn fuzz_deposit_and_swap_sequences(
        initial_a in 50_000i128..500_000i128,
        initial_b in 50_000i128..500_000i128,
        deposits in prop::collection::vec(
            (10_000i128..100_000i128, 10_000i128..100_000i128),
            0..5,
        ),
        amounts_in in prop::collection::vec(1_000i128..100_000i128, 0..15),
        directions in prop::collection::vec(proptest::bool::ANY, 0..15),
    ) {
        let (_env, client, token_a, token_b, user) = setup_pool(initial_a, initial_b);

        for (amt_a, amt_b) in deposits {
            let (r_a, r_b) = client.get_reserves();
            let k_before = r_a * r_b;

            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.deposit(&user, &amt_a, &amt_b);
            }));
            if result.is_err() {
                continue;
            }

            let (r_a2, r_b2) = client.get_reserves();
            let k_after = r_a2 * r_b2;

            prop_assert!(
                k_after >= k_before,
                "deposit must not decrease k"
            );
            prop_assert!(
                r_a2 >= r_a,
                "reserve_a must not decrease after deposit, was {}, now {}", r_a, r_a2
            );
            prop_assert!(
                r_b2 >= r_b,
                "reserve_b must not decrease after deposit, was {}, now {}", r_b, r_b2
            );
        }

        let num_swaps = amounts_in.len().min(directions.len());
        for i in 0..num_swaps {
            let (r_a, r_b) = client.get_reserves();
            let k_before = r_a * r_b;

            let (token_in, _reserve_in) = if directions[i] {
                (token_a.clone(), r_a)
            } else {
                (token_b.clone(), r_b)
            };

            let amount_in = amounts_in[i];

            let (r_a2, r_b2) = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.swap(&user, &token_in, &amount_in, &0);
                client.get_reserves()
            })) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let k_after = r_a2 * r_b2;

            prop_assert!(
                k_after >= k_before,
                "k must not decrease after swap. before={}, after={}", k_before, k_after
            );
            prop_assert!(r_a2 >= 0, "reserve_a must be >= 0");
            prop_assert!(r_b2 >= 0, "reserve_b must be >= 0");
        }
    }

    #[test]
    fn fuzz_reserves_never_negative_after_swaps(
        initial_a in 500_000i128..5_000_000i128,
        initial_b in 500_000i128..5_000_000i128,
        amounts_in in prop::collection::vec(1_000i128..200_000i128, 1..30),
        directions in prop::collection::vec(proptest::bool::ANY, 1..30),
    ) {
        let (_env, client, token_a, token_b, user) = setup_pool(initial_a, initial_b);

        let num_swaps = amounts_in.len().min(directions.len());
        for i in 0..num_swaps {
            let (r_a, r_b) = client.get_reserves();

            let (token_in, _reserve_in) = if directions[i] {
                (token_a.clone(), r_a)
            } else {
                (token_b.clone(), r_b)
            };

            let amount_in = amounts_in[i];

            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.swap(&user, &token_in, &amount_in, &0);
            }));
            if result.is_err() {
                continue;
            }

            let (r_a2, r_b2) = client.get_reserves();
            prop_assert!(r_a2 >= 0, "reserve_a must be >= 0, got {}", r_a2);
            prop_assert!(r_b2 >= 0, "reserve_b must be >= 0, got {}", r_b2);
            // The constant product k = reserve_a * reserve_b must not decrease:
            // the 0.3% fee accrues to the pool, so every swap leaves the pool
            // solvent or better.
            //
            // The *sum* of the reserves is deliberately not asserted. In a
            // lopsided pool a swap legitimately turns a small amount of the
            // scarce reserve into a large amount of the abundant one, so the
            // sum can fall while k still rises — asserting on the sum fails for
            // perfectly valid pools.
            prop_assert!(
                r_a2 * r_b2 >= r_a * r_b,
                "constant product must not decrease after swap (+fee): {} * {} < {} * {}",
                r_a2,
                r_b2,
                r_a,
                r_b
            );
        }
    }
}
