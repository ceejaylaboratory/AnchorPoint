import { Request, Response } from 'express';
import { getInfo } from './info.controller';
import { ASSETS } from '../../config/assets';

jest.mock('../../config/assets', () => ({
  ASSETS: [
    {
      code: 'USDC',
      issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      type: 'credit_alphanum4',
      desc: 'USD Coin',
      minAmount: '0.01',
      maxAmount: '100000',
      feeType: 'flat',
      feeFixed: 0.1,
      feePercent: 0.001,
      feeMinimum: 0.01,
      depositEnabled: true,
      withdrawEnabled: true
    },
    {
      code: 'XLM',
      type: 'native',
      desc: 'Stellar Lumens',
      minAmount: '1',
      maxAmount: '1000000',
      feeType: 'percentage',
      feeFixed: 0,
      feePercent: 0,
      feeMinimum: 0,
      depositEnabled: true,
      withdrawEnabled: false
    }
  ]
}));

describe('Info Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let sendMock: jest.Mock;
  let setHeaderMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn().mockReturnValue(mockResponse);
    sendMock = jest.fn().mockReturnValue(mockResponse);
    setHeaderMock = jest.fn().mockReturnValue(mockResponse);

    mockRequest = {
      query: {},
      headers: {}
    };

    mockResponse = {
      json: jsonMock,
      send: sendMock,
      setHeader: setHeaderMock
    } as any;

    jest.clearAllMocks();
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.BASE_URL = 'http://localhost:3002';
  });

  describe('getInfo - JSON format', () => {
    it('should return info in JSON format by default', () => {
      mockRequest.query = {};
      mockRequest.headers = {};

      getInfo(mockRequest as Request, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalled();
      const response = jsonMock.mock.calls[0][0];
      expect(response).toHaveProperty('version');
      expect(response).toHaveProperty('network', 'testnet');
      expect(response).toHaveProperty('assets');
    });

    it('should return JSON when Accept header includes application/json', () => {
      mockRequest.query = {};
      mockRequest.headers = { accept: 'application/json' };

      getInfo(mockRequest as Request, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalled();
    });

    it('should include all assets in the response', () => {
      getInfo(mockRequest as Request, mockResponse as Response);

      const response = jsonMock.mock.calls[0][0];
      expect(response.assets).toHaveLength(2);
      expect(response.assets[0].code).toBe('USDC');
      expect(response.assets[1].code).toBe('XLM');
    });

    it('should include asset details with correct properties', () => {
      getInfo(mockRequest as Request, mockResponse as Response);

      const response = jsonMock.mock.calls[0][0];
      const usdcAsset = response.assets.find((a: any) => a.code === 'USDC');
      expect(usdcAsset).toHaveProperty('issuer');
      expect(usdcAsset).toHaveProperty('status', 'live');
      expect(usdcAsset).toHaveProperty('is_asset_anchored', true);
      expect(usdcAsset).toHaveProperty('desc', 'USD Coin');
      expect(usdcAsset).toHaveProperty('max_amount', '100000');
      expect(usdcAsset).toHaveProperty('min_amount', '0.01');
      expect(usdcAsset).toHaveProperty('fee_fixed', 0.1);
      expect(usdcAsset).toHaveProperty('fee_percent', 0.001);
    });

    it('should include fee variations for deposit and withdraw', () => {
      getInfo(mockRequest as Request, mockResponse as Response);

      const response = jsonMock.mock.calls[0][0];
      expect(response).toHaveProperty('fee_variations');
      expect(response.fee_variations).toHaveProperty('deposit');
      expect(response.fee_variations).toHaveProperty('withdraw');
    });

    it('should include only assets that support deposit in fee_variations.deposit', () => {
      getInfo(mockRequest as Request, mockResponse as Response);

      const response = jsonMock.mock.calls[0][0];
      expect(response.fee_variations.deposit).toHaveProperty('USDC');
      expect(response.fee_variations.deposit).toHaveProperty('XLM');
    });

    it('should include only assets that support withdraw in fee_variations.withdraw', () => {
      getInfo(mockRequest as Request, mockResponse as Response);

      const response = jsonMock.mock.calls[0][0];
      expect(response.fee_variations.withdraw).toHaveProperty('USDC');
      expect(response.fee_variations.withdraw).not.toHaveProperty('XLM');
    });

    it('should include accounts information', () => {
      getInfo(mockRequest as Request, mockResponse as Response);

      const response = jsonMock.mock.calls[0][0];
      expect(response.accounts).toHaveProperty('receiving');
    });

    it('should use environment variables for server URLs', () => {
      process.env.AUTH_SERVER = 'https://auth.example.com';
      process.env.TRANSFER_SERVER = 'https://transfer.example.com';

      getInfo(mockRequest as Request, mockResponse as Response);

      const response = jsonMock.mock.calls[0][0];
      expect(response.auth_server).toBe('https://auth.example.com');
      expect(response.transfer_server).toBe('https://transfer.example.com');
    });
  });

  describe('getInfo - TOML format', () => {
    it('should return TOML when format=toml query parameter is set', () => {
      mockRequest.query = { format: 'toml' };

      getInfo(mockRequest as Request, mockResponse as Response);

      expect(setHeaderMock).toHaveBeenCalledWith('Content-Type', 'text/toml');
      expect(sendMock).toHaveBeenCalled();
    });

    it('should return TOML when Accept header includes text/toml', () => {
      mockRequest.headers = { accept: 'text/toml' };

      getInfo(mockRequest as Request, mockResponse as Response);

      expect(setHeaderMock).toHaveBeenCalledWith('Content-Type', 'text/toml');
      expect(sendMock).toHaveBeenCalled();
    });

    it('should include required fields in TOML output', () => {
      mockRequest.query = { format: 'toml' };

      getInfo(mockRequest as Request, mockResponse as Response);

      const tomlOutput = sendMock.mock.calls[0][0];
      expect(tomlOutput).toContain('version =');
      expect(tomlOutput).toContain('network = "testnet"');
      expect(tomlOutput).toContain('signing_key =');
      expect(tomlOutput).toContain('horizon_url =');
      expect(tomlOutput).toContain('url = "http://localhost:3002"');
    });

    it('should include accounts section in TOML output', () => {
      mockRequest.query = { format: 'toml' };

      getInfo(mockRequest as Request, mockResponse as Response);

      const tomlOutput = sendMock.mock.calls[0][0];
      expect(tomlOutput).toContain('[accounts]');
      expect(tomlOutput).toContain('receiving =');
    });

    it('should include assets section in TOML output', () => {
      mockRequest.query = { format: 'toml' };

      getInfo(mockRequest as Request, mockResponse as Response);

      const tomlOutput = sendMock.mock.calls[0][0];
      expect(tomlOutput).toContain('[[assets]]');
      expect(tomlOutput).toContain('code = "USDC"');
      expect(tomlOutput).toContain('code = "XLM"');
    });

    it('should include fee variations section in TOML output', () => {
      mockRequest.query = { format: 'toml' };

      getInfo(mockRequest as Request, mockResponse as Response);

      const tomlOutput = sendMock.mock.calls[0][0];
      expect(tomlOutput).toContain('[fee_variations.deposit]');
      expect(tomlOutput).toContain('[fee_variations.withdraw]');
    });
  });

  describe('getInfo - environment variables', () => {
    it('should use default values when environment variables are not set', () => {
      delete process.env.AUTH_SERVER;
      delete process.env.FEDERATION_SERVER;

      getInfo(mockRequest as Request, mockResponse as Response);

      const response = jsonMock.mock.calls[0][0];
      expect(response.horizon_url).toBeDefined();
      expect(response.signing_key).toBeDefined();
    });

    it('should filter out undefined optional fields', () => {
      delete process.env.FEDERATION_SERVER;

      getInfo(mockRequest as Request, mockResponse as Response);

      const response = jsonMock.mock.calls[0][0];
      expect(response.federation_server).toBeUndefined();
    });

    it('should use TRANSFER_SERVER_SEP24 environment variable or construct default', () => {
      process.env.TRANSFER_SERVER_SEP24 = 'https://sep24.example.com';

      getInfo(mockRequest as Request, mockResponse as Response);

      const response = jsonMock.mock.calls[0][0];
      expect(response.transfer_server_sep24).toBe('https://sep24.example.com');
    });
  });
});
