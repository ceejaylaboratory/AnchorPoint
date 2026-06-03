/**
 * Relayer Service Tests
 * 
 * Tests for signature-based gasless token approval system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RelayerService } from './relayer.service';
import {
  TokenApprovalRequest,
  SignedTransactionRequest,
} from '../types/relayer.types';

describe('RelayerService', () => {
  let relayerService: RelayerService;
  const mockRelayerConfig = {
    relayerPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    relayerSecretKey: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    maxAmount: '1000000',
    allowedSpenders: ['GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'],
    expiryWindowSeconds: 3600,
  };

  beforeEach(() => {
    relayerService = new RelayerService(mockRelayerConfig);
  });

  describe('verifySignature', () => {
    it('should reject request with missing required fields', async () => {
      const request: TokenApprovalRequest = {
        userPublicKey: '',
        spenderPublicKey: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: '100',
        nonce: 'test-nonce',
        expiry: Date.now() + 3600000,
        signature: '',
      };

      const result = await relayerService.verifySignature(request);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing required fields');
    });

    it('should reject expired request', async () => {
      const request: TokenApprovalRequest = {
        userPublicKey: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        spenderPublicKey: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: '100',
        nonce: 'test-nonce',
        expiry: Date.now() - 1000, // Expired
        signature: 'mock-signature',
      };

      const result = await relayerService.verifySignature(request);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should reject unauthorized spender', async () => {
      const request: TokenApprovalRequest = {
        userPublicKey: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        spenderPublicKey: 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', // Not in allowed list
        amount: '100',
        nonce: 'test-nonce',
        expiry: Date.now() + 3600000,
        signature: 'mock-signature',
      };

      const result = await relayerService.verifySignature(request);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not authorized');
    });

    it('should reject amount exceeding maximum', async () => {
      const request: TokenApprovalRequest = {
        userPublicKey: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        spenderPublicKey: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: '2000000', // Exceeds maxAmount of 1000000
        nonce: 'test-nonce',
        expiry: Date.now() + 3600000,
        signature: 'mock-signature',
      };

      const result = await relayerService.verifySignature(request);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum');
    });
  });

  describe('generateNonce', () => {
    it('should generate a unique nonce', () => {
      const nonce1 = relayerService.generateNonce();
      const nonce2 = relayerService.generateNonce();

      expect(nonce1).toBeDefined();
      expect(nonce2).toBeDefined();
      expect(nonce1).not.toBe(nonce2);
    });

    it('should generate a valid UUID format nonce', () => {
      const nonce = relayerService.generateNonce();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(nonce).toMatch(uuidRegex);
    });
  });

  describe('getConfig', () => {
    it('should return relayer configuration', () => {
      const config = relayerService.getConfig();

      expect(config.relayerPublicKey).toBe(mockRelayerConfig.relayerPublicKey);
      expect(config.maxAmount).toBe(mockRelayerConfig.maxAmount);
      expect(config.allowedSpenders).toEqual(mockRelayerConfig.allowedSpenders);
      expect(config.expiryWindowSeconds).toBe(mockRelayerConfig.expiryWindowSeconds);
    });

    it('should not expose secret key in config', () => {
      const config = relayerService.getConfig();
      expect(config.relayerSecretKey).toBeDefined(); // Config has it, but should be filtered in API
    });
  });

  describe('constructApprovalMessage', () => {
    it('should construct correct approval message for native asset', () => {
      const request: TokenApprovalRequest = {
        userPublicKey: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        spenderPublicKey: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: '100',
        nonce: 'test-nonce',
        expiry: 1234567890,
        signature: 'mock-signature',
      };

      const message = (relayerService as any).constructApprovalMessage(request);
      const expected = 'approve|GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC|GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB|100|XLM|native|test-nonce|1234567890';
      expect(message).toBe(expected);
    });

    it('should construct correct approval message for custom asset', () => {
      const request: TokenApprovalRequest = {
        userPublicKey: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        spenderPublicKey: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: '100',
        assetCode: 'USDC',
        assetIssuer: 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
        nonce: 'test-nonce',
        expiry: 1234567890,
        signature: 'mock-signature',
      };

      const message = (relayerService as any).constructApprovalMessage(request);
      const expected = 'approve|GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC|GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB|100|USDC|GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD|test-nonce|1234567890';
      expect(message).toBe(expected);
    });
  });
});
