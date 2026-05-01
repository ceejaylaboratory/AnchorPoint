import { FeatureFlagService, FeatureFlag, FeatureFlagContext } from '../services/feature-flag.service';

describe('FeatureFlagService', () => {
  let service: FeatureFlagService;

  const mockRedisService = {
    getJSON: jest.fn(),
    setJSON: jest.fn(),
    del: jest.fn(),
  };

  const defaultFlags = new Map<string, FeatureFlag>([
    [
      'test.flag',
      {
        name: 'test.flag',
        enabled: true,
        description: 'Test flag',
        rolloutPercentage: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      'test.disabled',
      {
        name: 'test.disabled',
        enabled: false,
        description: 'Disabled test flag',
        rolloutPercentage: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      'test.rollout',
      {
        name: 'test.rollout',
        enabled: true,
        description: 'Rollout test flag',
        rolloutPercentage: 50,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  ]);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FeatureFlagService(
      mockRedisService as any,
      defaultFlags
    );
  });

  describe('isEnabled', () => {
    it('should return true for enabled flags', async () => {
      const result = await service.isEnabled('test.flag');
      expect(result).toBe(true);
    });

    it('should return false for disabled flags', async () => {
      const result = await service.isEnabled('test.disabled');
      expect(result).toBe(false);
    });

    it('should return false for non-existent flags', async () => {
      const result = await service.isEnabled('nonexistent.flag');
      expect(result).toBe(false);
    });

    it('should handle rollout percentage correctly', async () => {
      // Test consistent hashing for same user
      const context: FeatureFlagContext = { userId: 'user123' };
      const result1 = await service.isEnabled('test.rollout', context);
      const result2 = await service.isEnabled('test.rollout', context);
      expect(result1).toBe(result2);
    });

    it('should handle target users filtering', async () => {
      const flagWithTargets: FeatureFlag = {
        name: 'test.targeted',
        enabled: true,
        description: 'Targeted flag',
        rolloutPercentage: 100,
        targetUsers: ['user1', 'user2'],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await service.setFlag('test.targeted', flagWithTargets);

      // Should be enabled for target user
      const result1 = await service.isEnabled('test.targeted', { userId: 'user1' });
      expect(result1).toBe(true);

      // Should be disabled for non-target user
      const result2 = await service.isEnabled('test.targeted', { userId: 'user3' });
      expect(result2).toBe(false);
    });
  });

  describe('getFlag', () => {
    it('should retrieve an existing flag', async () => {
      const flag = await service.getFlag('test.flag');
      expect(flag).not.toBeNull();
      expect(flag?.name).toBe('test.flag');
    });

    it('should return null for non-existent flag', async () => {
      const flag = await service.getFlag('nonexistent.flag');
      expect(flag).toBeNull();
    });
  });

  describe('getAllFlags', () => {
    it('should return all flags', async () => {
      const flags = await service.getAllFlags();
      expect(flags.length).toBe(3);
      expect(flags.map(f => f.name)).toContain('test.flag');
      expect(flags.map(f => f.name)).toContain('test.disabled');
      expect(flags.map(f => f.name)).toContain('test.rollout');
    });
  });

  describe('setFlag', () => {
    it('should create a new flag', async () => {
      const newFlag: FeatureFlag = {
        name: 'new.flag',
        enabled: true,
        description: 'New flag',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await service.setFlag('new.flag', newFlag);
      const retrieved = await service.getFlag('new.flag');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('new.flag');
    });

    it('should update an existing flag', async () => {
      const flag = await service.getFlag('test.flag');
      if (flag) {
        flag.enabled = false;
        await service.setFlag('test.flag', flag);
      }

      const updated = await service.getFlag('test.flag');
      expect(updated?.enabled).toBe(false);
    });
  });

  describe('enableFlag / disableFlag', () => {
    it('should enable a disabled flag', async () => {
      await service.enableFlag('test.disabled');
      const flag = await service.getFlag('test.disabled');
      expect(flag?.enabled).toBe(true);
    });

    it('should disable an enabled flag', async () => {
      await service.disableFlag('test.flag');
      const flag = await service.getFlag('test.flag');
      expect(flag?.enabled).toBe(false);
    });
  });

  describe('updateRolloutPercentage', () => {
    it('should update rollout percentage', async () => {
      await service.updateRolloutPercentage('test.rollout', 75);
      const flag = await service.getFlag('test.rollout');
      expect(flag?.rolloutPercentage).toBe(75);
    });

    it('should throw on invalid percentage', async () => {
      await expect(
        service.updateRolloutPercentage('test.rollout', 150)
      ).rejects.toThrow();
    });
  });

  describe('target users', () => {
    it('should add target users', async () => {
      const flag = await service.getFlag('test.flag');
      if (flag) {
        flag.targetUsers = [];
        await service.setFlag('test.flag', flag);
      }

      await service.addTargetUsers('test.flag', ['user1', 'user2']);
      const updated = await service.getFlag('test.flag');
      expect(updated?.targetUsers).toContain('user1');
      expect(updated?.targetUsers).toContain('user2');
    });

    it('should remove target users', async () => {
      const flag = await service.getFlag('test.flag');
      if (flag) {
        flag.targetUsers = ['user1', 'user2', 'user3'];
        await service.setFlag('test.flag', flag);
      }

      await service.removeTargetUsers('test.flag', ['user2']);
      const updated = await service.getFlag('test.flag');
      expect(updated?.targetUsers).toContain('user1');
      expect(updated?.targetUsers).toContain('user3');
      expect(updated?.targetUsers).not.toContain('user2');
    });
  });

  describe('deleteFlag', () => {
    it('should delete a flag', async () => {
      await service.deleteFlag('test.flag');
      const flag = await service.getFlag('test.flag');
      expect(flag).toBeNull();
    });
  });

  describe('initialize', () => {
    it('should initialize with default flags', async () => {
      const newService = new FeatureFlagService();
      const flags = new Map([
        [
          'init.flag',
          {
            name: 'init.flag',
            enabled: true,
            description: 'Init flag',
            createdAt: new Date(),
            updatedAt: new Date(),
          } as FeatureFlag,
        ],
      ]);

      await newService.initialize(flags);
      const initialized = await newService.getFlag('init.flag');
      expect(initialized).not.toBeNull();
    });
  });
});
