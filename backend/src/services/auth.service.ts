import {
  Keypair,
  WebAuth,
} from '@stellar/stellar-sdk';

/**
 * AuthService handles Stellar Web Authentication (SEP-10).
 */
export class AuthService {
  /**
   * Generates a challenge transaction for SEP-10 authentication.
   * 
   * @param clientAccount - The public key of the client's account.
   * @param anchorKeypair - The Keypair of the anchor (server).
   * @param homeDomain - The domain of the anchor (e.g., example.com).
   * @param network - The Stellar network passphrase.
   * @param timeout - The duration in seconds for which the challenge is valid (default 300s).
   * @returns The base64-encoded transaction envelope XDR.
   */
  public generateChallenge(
    clientAccount: string,
    anchorKeypair: Keypair,
    homeDomain: string,
    network: string,
    timeout: number = 300
  ): string {
    return WebAuth.buildChallengeTx(
      anchorKeypair,
      clientAccount,
      homeDomain,
      timeout,
      network,
      homeDomain // webAuthDomain
    );
  }

  public static generateChallengeTx(
    anchorKeypair: Keypair,
    clientAccount: string,
    homeDomain: string,
    network: string,
    timeout: number = 300
  ): string {
    return WebAuth.buildChallengeTx(
      anchorKeypair,
      clientAccount,
      homeDomain,
      timeout,
      network,
      homeDomain // webAuthDomain
    );
  }

  /**
   * Verifies a challenge transaction and returns the client's public key.
   * 
   * @param txnEnvelopeXdr - The base64-encoded transaction envelope XDR.
   * @param anchorAccount - The public key of the anchor's account.
   * @param network - The Stellar network passphrase.
   * @param homeDomain - The domain of the anchor.
   * @returns The client's public key if verification succeeds.
   * @throws Error if verification fails.
   */
  public static verifyChallenge(
    txnEnvelopeXdr: string,
    anchorAccount: string,
    network: string,
    homeDomain: string
  ): string {
    // Read the challenge to get the client account ID
    const { clientAccountID } = WebAuth.readChallengeTx(
      txnEnvelopeXdr,
      anchorAccount,
      network,
      [homeDomain],
      homeDomain // webAuthDomain
    );

    // Verify signatures. We check that the client account signed the transaction.
    try {
      WebAuth.verifyChallengeTxSigners(
        txnEnvelopeXdr,
        anchorAccount,
        network,
        [clientAccountID],
        [homeDomain],
        homeDomain // webAuthDomain
      );
    } catch (error: any) {
      throw new Error(`Challenge verification failed: ${error.message}`);
    }

    return clientAccountID;
  }
}
