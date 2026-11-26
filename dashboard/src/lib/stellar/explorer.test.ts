import { describe, expect, it } from 'vitest';
import {
  horizonLedgerUrl,
  horizonTxUrl,
  isTransactionHash,
  stellarExpertTxUrl,
  transactionExplorerLinks,
} from './explorer';

const HASH = 'b'.repeat(64);

describe('explorer links', () => {
  it('builds StellarExpert URLs per network', () => {
    expect(stellarExpertTxUrl('TESTNET', HASH)).toBe(`https://stellar.expert/explorer/testnet/tx/${HASH}`);
    expect(stellarExpertTxUrl('PUBLIC', HASH)).toBe(`https://stellar.expert/explorer/public/tx/${HASH}`);
    expect(stellarExpertTxUrl('FUTURENET', HASH)).toBeNull();
  });

  it('builds Horizon URLs from the network endpoints', () => {
    expect(horizonTxUrl('PUBLIC', HASH)).toBe(`https://horizon.stellar.org/transactions/${HASH}`);
    expect(horizonLedgerUrl('FUTURENET', 7)).toBe('https://horizon-futurenet.stellar.org/ledgers/7');
  });

  it('falls back to Horizon for ledgers on Futurenet', () => {
    const links = transactionExplorerLinks('FUTURENET', HASH, 7);
    expect(links.map((l) => l.href)).toEqual([
      `https://horizon-futurenet.stellar.org/transactions/${HASH}`,
      'https://horizon-futurenet.stellar.org/ledgers/7',
    ]);
  });

  it('encodes path segments', () => {
    expect(horizonTxUrl('TESTNET', 'a/b?c')).toBe('https://horizon-testnet.stellar.org/transactions/a%2Fb%3Fc');
  });

  it('recognises only 64-char hex hashes', () => {
    expect(isTransactionHash(HASH)).toBe(true);
    expect(isTransactionHash('HASH-123')).toBe(false);
    expect(isTransactionHash(undefined)).toBe(false);
  });
});
