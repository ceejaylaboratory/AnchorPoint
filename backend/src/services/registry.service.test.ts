import { RegistryService } from './registry.service';
import { AdvancedCacheService } from './advanced-cache.service';
import { stellarService } from './stellar.service';
import { redisService } from './redis.service';

// Mock dependencies
jest.mock('./advanced-cache.service');
jest.mock('./stellar.service');
jest.mock('./redis.service', () => ({
  redisService: {
    client: {},
  },
}));

const mockCacheService = AdvancedCacheService as jest.MockedClass<typeof AdvancedCacheService>;
const mockStellarService = stellarService as jest.Mocked<typeof stellarService>;

describe('RegistryService', () => {
  let registryService: RegistryService;
  let mockCache: jest.Mocked<AdvancedCacheService>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock cache service
    mockCache = {
      cacheAside: jest.fn(),
      invalidate: jest.fn(),
      invalidatePattern: jest.fn(),
    } as any;

    mockCacheService.mockImplementation(() => mockCache);

    // Get instance of RegistryService
    registryService = RegistryService.getInstance();
  });

  describe('getContract', () => {
    it('should return cached contract info when available', async () => {
      const mockContractInfo = {
        address: 'GABC123',
        version: '1.0.0',
        contractType: 'AMM',
        deployedAt: 1234567890,
        active: true,
        previousVersion: null,
      };

      mockCache.cacheAside.mockResolvedValue({
        data: mockContractInfo,
        fromCache: true,
      });

      const result = await registryService.getContract('AMM');

      expect(result).toEqual(mockContractInfo);
      expect(mockCache.cacheAside).toHaveBeenCalledWith(
        'registry:contract:AMM',
        expect.any(Function),
        expect.any(Object)
      );
    });

    it('should fetch fresh data when cache miss', async () => {
      const mockContractInfo = {
        address: 'GDEF456',
        version: '2.0.0',
        contractType: 'Lending',
        deployedAt: 9876543210,
        active: true,
        previousVersion: 'GABC123',
      };

      mockCache.cacheAside.mockResolvedValue({
        data: mockContractInfo,
        fromCache: false,
      });

      const result = await registryService.getContract('Lending');

      expect(result).toEqual(mockContractInfo);
    });
  });

  describe('getAddress', () => {
    it('should return contract address from cached info', async () => {
      const mockAddress = 'GADDRESS123';
      const mockContractInfo = {
        address: mockAddress,
        version: '1.0.0',
        contractType: 'Bridge',
        deployedAt: 1234567890,
        active: true,
        previousVersion: null,
      };

      mockCache.cacheAside.mockResolvedValue({
        data: mockContractInfo,
        fromCache: true,
      });

      const result = await registryService.getAddress('Bridge');

      expect(result).toBe(mockAddress);
    });
  });

  describe('getVersion', () => {
    it('should return contract version from cached info', async () => {
      const mockVersion = '3.1.4';
      const mockContractInfo = {
        address: 'GVER123',
        version: mockVersion,
        contractType: 'XLMWrapper',
        deployedAt: 1234567890,
        active: true,
        previousVersion: null,
      };

      mockCache.cacheAside.mockResolvedValue({
        data: mockContractInfo,
        fromCache: true,
      });

      const result = await registryService.getVersion('XLMWrapper');

      expect(result).toBe(mockVersion);
    });
  });

  describe('isRegistered', () => {
    it('should return true when contract is registered', async () => {
      const mockContractInfo = {
        address: 'GREG123',
        version: '1.0.0',
        contractType: 'Governance',
        deployedAt: 1234567890,
        active: true,
        previousVersion: null,
      };

      mockCache.cacheAside.mockResolvedValue({
        data: mockContractInfo,
        fromCache: true,
      });

      const result = await registryService.isRegistered('Governance');

      expect(result).toBe(true);
    });

    it('should return false when contract is not registered', async () => {
      mockCache.cacheAside.mockRejectedValue(new Error('Contract not found'));

      const result = await registryService.isRegistered('NonExistent');

      expect(result).toBe(false);
    });
  });

  describe('isActive', () => {
    it('should return true when contract is active', async () => {
      const mockContractInfo = {
        address: 'GACT123',
        version: '1.0.0',
        contractType: 'ActiveContract',
        deployedAt: 1234567890,
        active: true,
        previousVersion: null,
      };

      mockCache.cacheAside.mockResolvedValue({
        data: mockContractInfo,
        fromCache: true,
      });

      const result = await registryService.isActive('ActiveContract');

      expect(result).toBe(true);
    });

    it('should return false when contract is inactive', async () => {
      const mockContractInfo = {
        address: 'GINACT123',
        version: '1.0.0',
        contractType: 'InactiveContract',
        deployedAt: 1234567890,
        active: false,
        previousVersion: null,
      };

      mockCache.cacheAside.mockResolvedValue({
        data: mockContractInfo,
        fromCache: true,
      });

      const result = await registryService.isActive('InactiveContract');

      expect(result).toBe(false);
    });
  });

  describe('invalidateContractCache', () => {
    it('should invalidate cache for a specific contract type', async () => {
      await registryService.invalidateContractCache('AMM');

      expect(mockCache.invalidate).toHaveBeenCalledWith('registry:contract:AMM');
    });
  });

  describe('invalidateAllCache', () => {
    it('should invalidate all registry cache', async () => {
      await registryService.invalidateAllCache();

      expect(mockCache.invalidatePattern).toHaveBeenCalledWith('registry:.*');
    });
  });
});
