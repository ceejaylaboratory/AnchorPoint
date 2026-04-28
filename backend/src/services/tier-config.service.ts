export type Tier = "Free" | "Pro" | "Enterprise";

export interface TierLimits {
  burstLimit: number;
  sustainedLimit: number;
}

const DEFAULTS: Record<Tier, TierLimits> = {
  Free: { burstLimit: 5, sustainedLimit: 60 },
  Pro: { burstLimit: 20, sustainedLimit: 600 },
  Enterprise: { burstLimit: 100, sustainedLimit: 3000 },
};

const ENV_KEYS: Record<Tier, { burst: string; sustained: string }> = {
  Free: { burst: "TIER_FREE_BURST", sustained: "TIER_FREE_SUSTAINED" },
  Pro: { burst: "TIER_PRO_BURST", sustained: "TIER_PRO_SUSTAINED" },
  Enterprise: {
    burst: "TIER_ENTERPRISE_BURST",
    sustained: "TIER_ENTERPRISE_SUSTAINED",
  },
};

export class TierConfigService {
  getLimits(tier: Tier): TierLimits {
    const defaults = DEFAULTS[tier];
    if (!defaults) {
      throw new Error(
        `Unknown tier: "${tier}". Valid tiers are: Free, Pro, Enterprise.`,
      );
    }

    const envKeys = ENV_KEYS[tier];
    const burstEnv = process.env[envKeys.burst];
    const sustainedEnv = process.env[envKeys.sustained];

    return {
      burstLimit:
        burstEnv !== undefined ? parseInt(burstEnv, 10) : defaults.burstLimit,
      sustainedLimit:
        sustainedEnv !== undefined
          ? parseInt(sustainedEnv, 10)
          : defaults.sustainedLimit,
    };
  }
}
