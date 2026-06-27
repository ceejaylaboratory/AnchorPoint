import * as fc from "fast-check";
import { TierConfigService, Tier } from "./tier-config.service";

// Feature: dynamic-rate-limiting, Property 9: Tier config env-var override
// Validates: Requirements 2.3

describe("TierConfigService", () => {
  describe("Property 9: Tier config env-var override", () => {
    const tiers: Tier[] = ["Free", "Pro", "Enterprise"];

    const envKeyMap: Record<Tier, { burst: string; sustained: string }> = {
      Free: { burst: "TIER_FREE_BURST", sustained: "TIER_FREE_SUSTAINED" },
      Pro: { burst: "TIER_PRO_BURST", sustained: "TIER_PRO_SUSTAINED" },
      Enterprise: {
        burst: "TIER_ENTERPRISE_BURST",
        sustained: "TIER_ENTERPRISE_SUSTAINED",
      },
    };

    afterEach(() => {
      // Clean up all tier env vars after each test
      for (const tier of tiers) {
        delete process.env[envKeyMap[tier].burst];
        delete process.env[envKeyMap[tier].sustained];
      }
    });

    it.each(tiers)(
      "resolved limits for %s match env-var overrides for any positive integers",
      (tier) => {
        fc.assert(
          fc.property(
            fc.integer({ min: 1, max: 100_000 }),
            fc.integer({ min: 1, max: 100_000 }),
            (burst, sustained) => {
              const { burst: burstKey, sustained: sustainedKey } =
                envKeyMap[tier];

              process.env[burstKey] = String(burst);
              process.env[sustainedKey] = String(sustained);

              const service = new TierConfigService();
              const limits = service.getLimits(tier);

              delete process.env[burstKey];
              delete process.env[sustainedKey];

              return (
                limits.burstLimit === burst &&
                limits.sustainedLimit === sustained
              );
            },
          ),
          { numRuns: 100 },
        );
      },
    );
  });
});

// Unit tests for TierConfigService
// Validates: Requirements 2.1, 2.2, 2.3, 2.4
describe("TierConfigService unit tests", () => {
  const envVars = [
    "TIER_FREE_BURST",
    "TIER_FREE_SUSTAINED",
    "TIER_PRO_BURST",
    "TIER_PRO_SUSTAINED",
    "TIER_ENTERPRISE_BURST",
    "TIER_ENTERPRISE_SUSTAINED",
  ];

  beforeEach(() => {
    envVars.forEach((key) => delete process.env[key]);
  });

  afterEach(() => {
    envVars.forEach((key) => delete process.env[key]);
  });

  describe("default values", () => {
    it("returns correct defaults for Free tier", () => {
      const service = new TierConfigService();
      const limits = service.getLimits("Free");
      expect(limits.burstLimit).toBe(5);
      expect(limits.sustainedLimit).toBe(60);
    });

    it("returns correct defaults for Pro tier", () => {
      const service = new TierConfigService();
      const limits = service.getLimits("Pro");
      expect(limits.burstLimit).toBe(20);
      expect(limits.sustainedLimit).toBe(600);
    });

    it("returns correct defaults for Enterprise tier", () => {
      const service = new TierConfigService();
      const limits = service.getLimits("Enterprise");
      expect(limits.burstLimit).toBe(100);
      expect(limits.sustainedLimit).toBe(3000);
    });
  });

  describe("env-var overrides", () => {
    it("overrides Free burst limit from env var", () => {
      process.env.TIER_FREE_BURST = "42";
      const service = new TierConfigService();
      expect(service.getLimits("Free").burstLimit).toBe(42);
    });

    it("overrides Free sustained limit from env var", () => {
      process.env.TIER_FREE_SUSTAINED = "999";
      const service = new TierConfigService();
      expect(service.getLimits("Free").sustainedLimit).toBe(999);
    });

    it("overrides Pro burst and sustained limits from env vars", () => {
      process.env.TIER_PRO_BURST = "50";
      process.env.TIER_PRO_SUSTAINED = "1500";
      const service = new TierConfigService();
      const limits = service.getLimits("Pro");
      expect(limits.burstLimit).toBe(50);
      expect(limits.sustainedLimit).toBe(1500);
    });

    it("overrides Enterprise burst and sustained limits from env vars", () => {
      process.env.TIER_ENTERPRISE_BURST = "200";
      process.env.TIER_ENTERPRISE_SUSTAINED = "6000";
      const service = new TierConfigService();
      const limits = service.getLimits("Enterprise");
      expect(limits.burstLimit).toBe(200);
      expect(limits.sustainedLimit).toBe(6000);
    });

    it("env-var override takes precedence over default", () => {
      process.env.TIER_FREE_BURST = "1";
      const service = new TierConfigService();
      // Default is 5, env var should win
      expect(service.getLimits("Free").burstLimit).toBe(1);
    });
  });

  describe("unknown tier", () => {
    it("throws when given an unknown tier", () => {
      const service = new TierConfigService();
      expect(() => service.getLimits("Unknown" as Tier)).toThrow();
    });

    it("error message mentions the unknown tier name", () => {
      const service = new TierConfigService();
      expect(() => service.getLimits("Gold" as Tier)).toThrow(/Gold/);
    });
  });
});
