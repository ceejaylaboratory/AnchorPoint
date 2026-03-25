import { Keypair, Networks, WebAuth, TransactionBuilder } from '@stellar/stellar-sdk';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const anchorKeypair = Keypair.random();
  const clientKeypair = Keypair.random();
  const network = Networks.TESTNET;
  const homeDomain = 'test.anchor.com';

  describe('generateChallenge', () => {
    it('should generate a valid SEP-10 challenge transaction', () => {
      const challengeXdr = AuthService.generateChallengeTx(
        anchorKeypair,
        clientKeypair.publicKey(),
        homeDomain,
        network
      );

      expect(challengeXdr).toBeDefined();
      expect(typeof challengeXdr).toBe('string');

      // Verify the generated challenge
      const { clientAccountID } = WebAuth.readChallengeTx(
        challengeXdr,
        anchorKeypair.publicKey(),
        network,
        [homeDomain],
        homeDomain
      );

      expect(clientAccountID).toBe(clientKeypair.publicKey());
    });
  });

  describe('verifyChallenge', () => {
    it('should verify a correctly signed challenge', () => {
      const challengeXdr = AuthService.generateChallengeTx(
        anchorKeypair,
        clientKeypair.publicKey(),
        homeDomain,
        network
      );

      // In SEP-10, the client signs the challenge transaction
      const transaction = TransactionBuilder.fromXDR(challengeXdr, network);
      transaction.sign(clientKeypair);
      const clientSignedTx = transaction.toEnvelope().toXDR('base64');

      const verifiedClientAccount = AuthService.verifyChallenge(
        clientSignedTx,
        anchorKeypair.publicKey(),
        network,
        homeDomain
      );

      expect(verifiedClientAccount).toBe(clientKeypair.publicKey());
    });

    it('should throw an error if the client signature is missing', () => {
      const challengeXdr = AuthService.generateChallengeTx(
        anchorKeypair,
        clientKeypair.publicKey(),
        homeDomain,
        network
      );

      // Note: challengeXdr is already signed by the anchor (server) inside AuthService.generateChallengeTx
      
      expect(() => {
        AuthService.verifyChallenge(
          challengeXdr,
          anchorKeypair.publicKey(),
          network,
          homeDomain
        );
      }).toThrow('Challenge verification failed');
    });

    it('should throw an error if the signature is from a wrong account', () => {
      const challengeXdr = AuthService.generateChallengeTx(
        anchorKeypair,
        clientKeypair.publicKey(),
        homeDomain,
        network
      );

      const wrongKeypair = Keypair.random();
      const transaction = TransactionBuilder.fromXDR(challengeXdr, network);
      transaction.sign(wrongKeypair);
      const wrongSignedTx = transaction.toEnvelope().toXDR('base64');

      expect(() => {
        AuthService.verifyChallenge(
          wrongSignedTx,
          anchorKeypair.publicKey(),
          network,
          homeDomain
        );
      }).toThrow('Challenge verification failed');
    });

    it('should throw error if readChallengeTx fails (invalid network/domain)', () => {
      const challengeXdr = AuthService.generateChallengeTx(
        anchorKeypair,
        clientKeypair.publicKey(),
        homeDomain,
        network
      );

      expect(() => {
        AuthService.verifyChallenge(
          challengeXdr,
          anchorKeypair.publicKey(),
          Networks.PUBLIC, // Wrong network
          homeDomain
        );
      }).toThrow();
    });
  });

  describe('AuthService instance methods', () => {
    it('should generate a challenge using instance method', () => {
      const authService = new AuthService();
      const challengeXdr = authService.generateChallenge(
        clientKeypair.publicKey(),
        anchorKeypair,
        homeDomain,
        network
      );

      expect(challengeXdr).toBeDefined();
    });
  });
});
