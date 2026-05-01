/**
 * Authentication threshold configuration for SEP-10 multi-key authentication
 */

export interface AuthThresholdConfig {
  low: number;
  medium: number;
  high: number;
}

export interface AuthConfig {
  thresholds: AuthThresholdConfig;
  challengeTTL: number;
  tokenExpiration: number;
  maxSigners: number;
}

export const defaultAuthConfig: AuthConfig = {
  thresholds: {
    low: 1,
    medium: 2,
    high: 3
  },
  challengeTTL: 300, // 5 minutes
  tokenExpiration: 3600, // 1 hour
  maxSigners: 10
};

/**
 * Get authentication configuration for a specific network
 */
export const getAuthConfig = (network: string = 'testnet'): AuthConfig => {
  // Network-specific configurations can be added here
  const networkConfigs: Record<string, Partial<AuthConfig>> = {
    mainnet: {
      thresholds: {
        low: 1,
        medium: 2,
        high: 3
      },
      challengeTTL: 300,
      tokenExpiration: 1800 // 30 minutes for mainnet
    },
    testnet: {
      thresholds: {
        low: 1,
        medium: 2,
        high: 3
      },
      challengeTTL: 600, // 10 minutes for testnet
      tokenExpiration: 3600 // 1 hour for testnet
    }
  };

  return {
    ...defaultAuthConfig,
    ...networkConfigs[network]
  };
};

/**
 * Validate threshold configuration
 */
export const validateThresholdConfig = (config: AuthThresholdConfig): boolean => {
  return (
    config.low > 0 &&
    config.medium > config.low &&
    config.high > config.medium &&
    config.high <= 10 // Maximum reasonable threshold
  );
};

/**
 * Get required weight for authentication level
 */
export const getRequiredWeight = (level: 'low' | 'medium' | 'high', config: AuthThresholdConfig): number => {
  switch (level) {
    case 'low':
      return config.low;
    case 'medium':
      return config.medium;
    case 'high':
      return config.high;
    default:
      return config.medium;
  }
};
