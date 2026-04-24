
use soroban_sdk::{contracttype, Vec};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FeeTier {
    pub volume_threshold: i128,
    pub fee_bps: i128, // 10000 = 100%
}

/**
 * Calculates a dynamic fee based on volume tiers.
 * As volume increases, the fee generally decreases.
 */
pub fn calculate_dynamic_fee(amount: i128, volume: i128, tiers: Vec<FeeTier>) -> i128 {
    // Default fee if no tiers match or list is empty
    let mut selected_bps = 30; // 0.3% default
    
    for tier in tiers.iter() {
        if volume >= tier.volume_threshold {
            selected_bps = tier.fee_bps;
        } else {
            // Assume tiers are sorted by volume_threshold ascending
            break;
        }
    }

    (amount * selected_bps) / 10000
}

/**
 * Basic fee calculation using basis points.
 */
pub fn calculate_simple_fee(amount: i128, fee_bps: i128) -> i128 {
    (amount * fee_bps) / 10000
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{Env, vec};

    #[test]
    fn test_calculate_simple_fee() {
        assert_eq!(calculate_simple_fee(10000, 30), 30);
        assert_eq!(calculate_simple_fee(10000, 100), 100);
    }

    #[test]
    fn test_calculate_dynamic_fee() {
        let env = Env::default();
        let tiers = vec![&env, 
            FeeTier { volume_threshold: 0, fee_bps: 30 },
            FeeTier { volume_threshold: 1000, fee_bps: 20 },
            FeeTier { volume_threshold: 5000, fee_bps: 10 },
        ];

        // Tier 0
        assert_eq!(calculate_dynamic_fee(10000, 500, tiers.clone()), 30);
        // Tier 1
        assert_eq!(calculate_dynamic_fee(10000, 1500, tiers.clone()), 20);
        // Tier 2
        assert_eq!(calculate_dynamic_fee(10000, 6000, tiers.clone()), 10);
    }
}
