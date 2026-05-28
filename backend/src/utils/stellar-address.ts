import { StrKey } from '@stellar/stellar-sdk';

const STELLAR_PUBLIC_KEY_LENGTH = 56;
const STELLAR_PUBLIC_KEY_PREFIX = 'G';

/**
 * Validates canonical Stellar Ed25519 account public keys.
 *
 * The application accepts classic account IDs only (`G...`). Inputs such as
 * secret seeds (`S...`), muxed accounts (`M...`), contract IDs (`C...`), empty
 * strings, and padded values are intentionally rejected at request boundaries.
 */
export const isValidStellarPublicKey = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    value.length !== STELLAR_PUBLIC_KEY_LENGTH ||
    value[0] !== STELLAR_PUBLIC_KEY_PREFIX
  ) {
    return false;
  }

  return StrKey.isValidEd25519PublicKey(value);
};
