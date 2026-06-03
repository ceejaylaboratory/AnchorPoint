import * as StellarSdk from '@stellar/stellar-sdk';
import { NETWORKS, NetworkType } from '../config/networks';

/**
 * SEP-10 Challenge Generation and Verification Utilities
 * Supports hardware wallets (Trezor, Ledger) which require proper Stellar transaction format
 */

export interface Sep10Challenge {
  transactionXdr: string;
  challenge: string;
  networkPassphrase: string;
}

export interface Sep10Verification {
  isValid: boolean;
  account: string;
  challenge: string;
}

/**
 * Generates a SEP-10 compliant challenge transaction
 * @param anchorPublicKey The anchor's public key (source account)
 * @param clientPublicKey The client's public key (for manage_data operation)
 * @param networkType The Stellar network type
 * @param challengeValue Random challenge string
 * @returns SEP-10 challenge object
 */
export function generateSep10Challenge(
  anchorPublicKey: string,
  clientPublicKey: string,
  networkType: NetworkType,
  challengeValue: string
): Sep10Challenge {
  const networkPassphrase = NETWORKS[networkType].passphrase;

  // Create a transaction with sequence number 0 (as per SEP-10)
  const account = new StellarSdk.Account(anchorPublicKey, '0');

  // Create manage_data operation with the challenge
  const manageDataOp = StellarSdk.Operation.manageData({
    name: `stellar.sep10.challenge`,
    value: challengeValue,
    source: clientPublicKey
  });

  // Set time bounds (5 minutes validity)
  const now = Math.floor(Date.now() / 1000);
  const timeBounds = {
    minTime: now,
    maxTime: now + 300 // 5 minutes
  };

  // Build the transaction
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
    timeBounds
  })
    .addOperation(manageDataOp)
    .build();

  return {
    transactionXdr: transaction.toXDR(),
    challenge: challengeValue,
    networkPassphrase
  };
}

/**
 * Verifies a signed SEP-10 challenge transaction
 * @param signedTransactionXdr The signed transaction in XDR format
 * @param expectedChallenge The expected challenge value
 * @param networkType The Stellar network type
 * @returns Verification result
 */
export function verifySep10Challenge(
  signedTransactionXdr: string,
  expectedChallenge: string,
  networkType: NetworkType
): Sep10Verification {
  try {
    const networkPassphrase = NETWORKS[networkType].passphrase;

    // Parse the signed transaction
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      signedTransactionXdr,
      networkPassphrase
    ) as StellarSdk.Transaction;

    // Verify the transaction has exactly one operation
    if (transaction.operations.length !== 1) {
      return { isValid: false, account: '', challenge: '' };
    }

    const operation = transaction.operations[0];

    // Verify it's a manage_data operation
    if (operation.type !== 'manageData') {
      return { isValid: false, account: '', challenge: '' };
    }

    const manageDataOp = operation as StellarSdk.Operation.ManageData;

    // Verify the data name is correct
    if (manageDataOp.name !== 'stellar.sep10.challenge') {
      return { isValid: false, account: '', challenge: '' };
    }

    // Verify the challenge value matches
    const challengeValue = manageDataOp.value?.toString('utf8');
    if (challengeValue !== expectedChallenge) {
      return { isValid: false, account: '', challenge: '' };
    }

    // Get the source account from the operation
    const account = manageDataOp.source;

    if (!account) {
      return { isValid: false, account: '', challenge: '' };
    }

    // Verify the transaction signature
    // For hardware wallets, we need to check that the signature is valid
    // The transaction should be signed by the account that matches the operation source
    const keypair = StellarSdk.Keypair.fromPublicKey(account);

    // Verify signatures
    const validSignatures = transaction.signatures.filter(signature => {
      try {
        return keypair.verify(transaction.hash(), signature.signature());
      } catch {
        return false;
      }
    });

    if (validSignatures.length === 0) {
      return { isValid: false, account: '', challenge: '' };
    }

    return {
      isValid: true,
      account,
      challenge: challengeValue
    };

  } catch (error) {
    // Invalid transaction format or parsing error
    return { isValid: false, account: '', challenge: '' };
  }
}

/**
 * Extracts the account public key from a signed SEP-10 transaction
 * @param signedTransactionXdr The signed transaction XDR
 * @param networkType The Stellar network type
 * @returns The account public key or null if invalid
 */
export function extractAccountFromSep10Transaction(
  signedTransactionXdr: string,
  networkType: NetworkType
): string | null {
  try {
    const networkPassphrase = NETWORKS[networkType].passphrase;
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      signedTransactionXdr,
      networkPassphrase
    ) as StellarSdk.Transaction;

    if (transaction.operations.length !== 1) {
      return null;
    }

    const operation = transaction.operations[0];
    if (operation.type !== 'manageData') {
      return null;
    }

    const manageDataOp = operation as StellarSdk.Operation.ManageData;
    return manageDataOp.source || null;

  } catch {
    return null;
  }
}