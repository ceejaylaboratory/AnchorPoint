import { Request, Response } from 'express';
import { depositInteractive, withdrawInteractive } from './sep24.controller';

describe('SEP-24 Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    
    mockRequest = {
      body: {}
    };
    
    mockResponse = {
      json: jsonMock,
      status: statusMock
    };
  });

  describe('depositInteractive', () => {
    it('should return error when asset_code is missing', () => {
      mockRequest.body = {};

      depositInteractive(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'asset_code is required'
      });
    });

    it('should return error for unsupported asset', () => {
      mockRequest.body = { asset_code: 'INVALID' };

      depositInteractive(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Asset INVALID is not supported. Supported assets: USDC, USD, BTC, ETH'
      });
    });

    it('should return interactive response for valid deposit request', () => {
      mockRequest.body = {
        asset_code: 'USDC',
        account: 'GTEST123',
        amount: '100',
        lang: 'en'
      };

      depositInteractive(mockRequest as Request, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'interactive_customer_info_needed',
          url: expect.stringContaining('/kyc-deposit'),
          id: expect.any(String)
        })
      );
    });
  });

  describe('withdrawInteractive', () => {
    it('should return error when asset_code is missing', () => {
      mockRequest.body = {};

      withdrawInteractive(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'asset_code is required'
      });
    });

    it('should return error for unsupported asset', () => {
      mockRequest.body = { asset_code: 'INVALID' };

      withdrawInteractive(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Asset INVALID is not supported. Supported assets: USDC, USD, BTC, ETH'
      });
    });

    it('should return interactive response for valid withdraw request', () => {
      mockRequest.body = {
        asset_code: 'USDC',
        account: 'GTEST123',
        amount: '100',
        dest: 'bank_account',
        dest_extra: 'routing_number',
        lang: 'en'
      };

      withdrawInteractive(mockRequest as Request, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'interactive_customer_info_needed',
          url: expect.stringContaining('/kyc-withdraw'),
          id: expect.any(String)
        })
      );
    });

    it('should include withdrawal-specific parameters in URL', () => {
      mockRequest.body = {
        asset_code: 'USDC',
        dest: 'bank_account',
        dest_extra: 'routing_123'
      };

      withdrawInteractive(mockRequest as Request, mockResponse as Response);

      const response = jsonMock.mock.calls[0][0];
      expect(response.url).toContain('dest=bank_account');
      expect(response.url).toContain('dest_extra=routing_123');
    });
  });
});
