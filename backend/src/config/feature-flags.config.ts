import { FeatureFlag } from '../services/feature-flag.service';

/**
 * Default feature flags configuration
 * These flags control the availability of specific SEPs and features
 * 
 * Each flag can have:
 * - enabled: boolean to toggle the feature on/off
 * - rolloutPercentage: 0-100 for gradual rollout (e.g., 50 = 50% of users)
 * - targetUsers: specific users/accounts to enable the feature for
 */
export const DEFAULT_FEATURE_FLAGS: Record<string, FeatureFlag> = {
  // SEP-6 (Deposit/Withdrawal)
  'sep6.enabled': {
    name: 'sep6.enabled',
    enabled: true,
    description: 'Enable SEP-6 Deposit and Withdrawal functionality',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'sep6.deposit': {
    name: 'sep6.deposit',
    enabled: true,
    description: 'Enable SEP-6 Deposit functionality',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'sep6.withdraw': {
    name: 'sep6.withdraw',
    enabled: true,
    description: 'Enable SEP-6 Withdrawal functionality',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // SEP-24 (Hosted UI)
  'sep24.enabled': {
    name: 'sep24.enabled',
    enabled: true,
    description: 'Enable SEP-24 Hosted Deposit and Withdrawal functionality',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'sep24.deposit': {
    name: 'sep24.deposit',
    enabled: true,
    description: 'Enable SEP-24 Hosted Deposit functionality',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'sep24.withdraw': {
    name: 'sep24.withdraw',
    enabled: true,
    description: 'Enable SEP-24 Hosted Withdrawal functionality',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // SEP-31 (Cross-Border Payments)
  'sep31.enabled': {
    name: 'sep31.enabled',
    enabled: true,
    description: 'Enable SEP-31 Cross-Border Payments functionality',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'sep31.send': {
    name: 'sep31.send',
    enabled: true,
    description: 'Enable SEP-31 Send Money functionality',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'sep31.receive': {
    name: 'sep31.receive',
    enabled: true,
    description: 'Enable SEP-31 Receive Money functionality',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // SEP-38 (Quotes)
  'sep38.enabled': {
    name: 'sep38.enabled',
    enabled: true,
    description: 'Enable SEP-38 Quote pricing functionality',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Contract Interactions
  'contract.swap': {
    name: 'contract.swap',
    enabled: true,
    description: 'Enable Swap contract interactions',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'contract.staking': {
    name: 'contract.staking',
    enabled: true,
    description: 'Enable Staking contract interactions',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'contract.liquidStaking': {
    name: 'contract.liquidStaking',
    enabled: true,
    description: 'Enable Liquid Staking contract interactions',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'contract.flashLoan': {
    name: 'contract.flashLoan',
    enabled: false,
    description: 'Enable Flash Loan contract interactions (experimental)',
    rolloutPercentage: 50,
    targetUsers: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'contract.amm': {
    name: 'contract.amm',
    enabled: true,
    description: 'Enable AMM (Automated Market Maker) contract interactions',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Advanced Features
  'feature.multisig': {
    name: 'feature.multisig',
    enabled: true,
    description: 'Enable Multisig transaction support',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'feature.batchPayments': {
    name: 'feature.batchPayments',
    enabled: true,
    description: 'Enable Batch Payment processing',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'feature.webhooks': {
    name: 'feature.webhooks',
    enabled: true,
    description: 'Enable Webhook notifications',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Performance and Security Features
  'feature.rateLimit': {
    name: 'feature.rateLimit',
    enabled: true,
    description: 'Enable rate limiting',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'feature.circuitBreaker': {
    name: 'feature.circuitBreaker',
    enabled: false,
    description: 'Enable circuit breaker for external service failures',
    rolloutPercentage: 25,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  'feature.analyticsTracking': {
    name: 'feature.analyticsTracking',
    enabled: true,
    description: 'Enable analytics event tracking',
    rolloutPercentage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Debug/Internal Features
  'debug.verbose': {
    name: 'debug.verbose',
    enabled: false,
    description: 'Enable verbose logging (internal use only)',
    rolloutPercentage: 0,
    targetUsers: ['admin@anchorpoint.dev'],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

/**
 * Convert default flags to a Map for easier usage
 */
export function getDefaultFlagsMap(): Map<string, FeatureFlag> {
  return new Map(Object.entries(DEFAULT_FEATURE_FLAGS));
}
