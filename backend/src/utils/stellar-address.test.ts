/// <reference types="jest" />
import { isValidStellarPublicKey } from './stellar-address';

const VALID_PUBLIC_KEY = 'GCM5WPR4DDR24FSAX5LIEM4J7AI3KOWJYANSXEPKYXCSZOTAYXE75AFN';

describe('isValidStellarPublicKey', () => {
  it('accepts a canonical Stellar Ed25519 public key', () => {
    expect(isValidStellarPublicKey(VALID_PUBLIC_KEY)).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['whitespace-only string', '   '],
    ['leading whitespace', ` ${VALID_PUBLIC_KEY}`],
    ['trailing whitespace', `${VALID_PUBLIC_KEY} `],
    ['lowercase public key', VALID_PUBLIC_KEY.toLowerCase()],
    ['checksum mismatch', `${VALID_PUBLIC_KEY.slice(0, -1)}A`],
    ['secret seed-like value', `S${VALID_PUBLIC_KEY.slice(1)}`],
    ['muxed account-like value', `M${VALID_PUBLIC_KEY.slice(1)}`],
    ['contract address-like value', `C${VALID_PUBLIC_KEY.slice(1)}`],
    ['null', null],
    ['undefined', undefined],
    ['number', 12345],
    ['object', { publicKey: VALID_PUBLIC_KEY }],
  ])('rejects %s', (_caseName, value) => {
    expect(isValidStellarPublicKey(value)).toBe(false);
  });
});
