import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADDRESS_BOOK_STORAGE_KEY,
  AddressBookError,
  addContact,
  deleteContact,
  isValidStellarPublicKey,
  listContacts,
  updateContact,
} from './addressBook';

vi.mock('@stellar/stellar-sdk', () => ({
  StrKey: {
    isValidEd25519PublicKey: (value: string) => /^G[A-Z2-7]{55}$/.test(value),
  },
}));

const TREASURY = 'GB2NUXFMQMK7WDUDCFUVX7CCXNUHPRGHZG4NPYVEBFSS6BOTT2N2NVGZ';
const OPS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('address book storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('rejects public keys that are not valid Ed25519 StrKeys', () => {
    expect(isValidStellarPublicKey('not-a-key')).toBe(false);
    expect(isValidStellarPublicKey('GINVALID')).toBe(false);
    expect(() => addContact('Ada', 'GINVALID')).toThrow(AddressBookError);
    expect(listContacts()).toEqual([]);
  });

  it('adds, updates, and deletes named contacts', () => {
    const saved = addContact('  Treasury  ', TREASURY);
    expect(saved.name).toBe('Treasury');
    expect(saved.publicKey).toBe(TREASURY);
    expect(isValidStellarPublicKey(saved.publicKey)).toBe(true);

    const renamed = updateContact(saved.id, { name: 'Ops', publicKey: OPS });
    expect(renamed).toMatchObject({ id: saved.id, name: 'Ops', publicKey: OPS });
    expect(listContacts()).toEqual([renamed]);

    deleteContact(saved.id);
    expect(listContacts()).toEqual([]);
    expect(localStorage.getItem(ADDRESS_BOOK_STORAGE_KEY)).toBe('[]');
  });

  it('refuses a duplicate public key', () => {
    const key = TREASURY;
    addContact('One', key);
    expect(() => addContact('Two', key)).toThrow(/already saved/);
    expect(listContacts()).toHaveLength(1);
  });
});
