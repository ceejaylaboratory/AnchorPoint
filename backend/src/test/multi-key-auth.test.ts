import { 
  generateChallenge, 
  generateMultiKeyChallenge,
  validateMultiKeySignatures,
  signToken,
  verifyToken,
  SignerInfo,
  SignatureInfo,
  MultiKeyVerifiedToken
} from '../services/auth.service';

describe('Multi-Key Authentication', () => {
  const mockSigners: SignerInfo[] = [
    { publicKey: 'GABC123...', weight: 1, signed: false },
    { publicKey: 'GDEF456...', weight: 2, signed: false },
    { publicKey: 'GHI789...', weight: 1, signed: false }
  ];

  describe('generateMultiKeyChallenge', () => {
    it('should generate a challenge with medium threshold by default', () => {
      const challenge = generateMultiKeyChallenge(mockSigners);
      
      expect(challenge.threshold).toBe('medium');
      expect(challenge.requiredSigners).toBeGreaterThan(0);
      expect(challenge.signers).toHaveLength(3);
      expect(challenge.signers.every(s => !s.signed)).toBe(true);
    });

    it('should generate a challenge with specified threshold', () => {
      const challenge = generateMultiKeyChallenge(mockSigners, 'high');
      
      expect(challenge.threshold).toBe('high');
      expect(challenge.requiredSigners).toBeGreaterThan(0);
    });

    it('should calculate required signers correctly', () => {
      const challenge = generateMultiKeyChallenge(mockSigners, 'medium');
      
      // Medium threshold requires weight 2, with max weight 2, so need 1 signer
      expect(challenge.requiredSigners).toBe(1);
    });
  });

  describe('validateMultiKeySignatures', () => {
    const mockSignatures: SignatureInfo[] = [
      { publicKey: 'GABC123...', signature: 'sig1', weight: 1 },
      { publicKey: 'GDEF456...', signature: 'sig2', weight: 2 }
    ];

    it('should validate signatures meeting medium threshold', () => {
      const result = validateMultiKeySignatures(mockSignatures, 'medium');
      
      expect(result.valid).toBe(true);
      expect(result.authLevel).toBe('medium');
      expect(result.signers).toContain('GABC123...');
      expect(result.signers).toContain('GDEF456...');
    });

    it('should validate signatures meeting high threshold', () => {
      const highWeightSignatures: SignatureInfo[] = [
        { publicKey: 'GABC123...', signature: 'sig1', weight: 2 },
        { publicKey: 'GDEF456...', signature: 'sig2', weight: 2 }
      ];
      
      const result = validateMultiKeySignatures(highWeightSignatures, 'high');
      
      expect(result.valid).toBe(true);
      expect(result.authLevel).toBe('full');
    });

    it('should reject signatures not meeting threshold', () => {
      const lowWeightSignatures: SignatureInfo[] = [
        { publicKey: 'GABC123...', signature: 'sig1', weight: 1 }
      ];
      
      const result = validateMultiKeySignatures(lowWeightSignatures, 'medium');
      
      expect(result.valid).toBe(false);
      expect(result.authLevel).toBe('partial');
    });

    it('should handle partial authentication correctly', () => {
      const partialSignatures: SignatureInfo[] = [
        { publicKey: 'GABC123...', signature: 'sig1', weight: 1 }
      ];
      
      const result = validateMultiKeySignatures(partialSignatures, 'low');
      
      expect(result.valid).toBe(true);
      expect(result.authLevel).toBe('partial');
    });
  });

  describe('Token Handling', () => {
    const mockPublicKey = 'GTEST123...';
    
    it('should sign and verify single-key token', () => {
      const token = signToken(mockPublicKey);
      const decoded = verifyToken(token);
      
      expect(decoded.sub).toBe(mockPublicKey);
      expect('signers' in decoded).toBe(false);
    });

    it('should sign and verify multi-key token', () => {
      const multiKeyData: MultiKeyVerifiedToken = {
        sub: mockPublicKey,
        signers: ['GABC123...', 'GDEF456...'],
        threshold: 'medium',
        authLevel: 'medium'
      };
      
      const token = signToken(mockPublicKey, multiKeyData);
      const decoded = verifyToken(token);
      
      expect(decoded.sub).toBe(mockPublicKey);
      expect('signers' in decoded).toBe(true);
      
      const multiKeyDecoded = decoded as MultiKeyVerifiedToken;
      expect(multiKeyDecoded.signers).toEqual(['GABC123...', 'GDEF456...']);
      expect(multiKeyDecoded.threshold).toBe('medium');
      expect(multiKeyDecoded.authLevel).toBe('medium');
    });

    it('should handle token verification errors', () => {
      expect(() => verifyToken('invalid-token')).toThrow();
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete multi-key authentication flow', () => {
      // 1. Generate challenge
      const challenge = generateMultiKeyChallenge(mockSigners, 'medium');
      expect(challenge.threshold).toBe('medium');
      
      // 2. Simulate signatures
      const signatures: SignatureInfo[] = [
        { publicKey: 'GDEF456...', signature: 'sig1', weight: 2 }
      ];
      
      // 3. Validate signatures
      const validation = validateMultiKeySignatures(signatures, 'medium');
      expect(validation.valid).toBe(true);
      
      // 4. Generate token
      const multiKeyData: MultiKeyVerifiedToken = {
        sub: 'GDEF456...',
        signers: validation.signers,
        threshold: 'medium',
        authLevel: validation.authLevel
      };
      
      const token = signToken('GDEF456...', multiKeyData);
      
      // 5. Verify token
      const decoded = verifyToken(token);
      expect(decoded.sub).toBe('GDEF456...');
      
      const multiKeyDecoded = decoded as MultiKeyVerifiedToken;
      expect(multiKeyDecoded.authLevel).toBe('medium');
    });
  });
});

describe('Authentication Middleware', () => {
  // Mock Express request/response
  const mockRequest = {
    headers: {},
    user: undefined
  };
  
  const mockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  };
  
  const mockNext = jest.fn();

  // Note: These tests would need to be adapted to work with the actual middleware
  // since Express types aren't fully available in this test environment
  
  it('should handle multi-key authentication in middleware', () => {
    // This is a conceptual test - actual implementation would require
    // proper Express mocking setup
    const multiKeyData: MultiKeyVerifiedToken = {
      sub: 'GTEST123...',
      signers: ['GABC123...', 'GDEF456...'],
      threshold: 'medium',
      authLevel: 'medium'
    };
    
    const token = signToken('GTEST123...', multiKeyData);
    const decoded = verifyToken(token);
    
    expect('signers' in decoded).toBe(true);
    const multiKeyDecoded = decoded as MultiKeyVerifiedToken;
    expect(multiKeyDecoded.authLevel).toBe('medium');
  });
});
