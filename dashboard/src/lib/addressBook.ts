import { StrKey } from '@stellar/stellar-sdk';

export const ADDRESS_BOOK_STORAGE_KEY = 'anchorpoint.addressBook';

export type AddressBookContact = {
  id: string;
  name: string;
  publicKey: string;
};

export class AddressBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddressBookError';
  }
}

export function isValidStellarPublicKey(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value.trim());
}

function readStore(): AddressBookContact[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(ADDRESS_BOOK_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is AddressBookContact =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as AddressBookContact).id === 'string' &&
        typeof (entry as AddressBookContact).name === 'string' &&
        typeof (entry as AddressBookContact).publicKey === 'string',
    );
  } catch {
    return [];
  }
}

function writeStore(contacts: AddressBookContact[]): void {
  localStorage.setItem(ADDRESS_BOOK_STORAGE_KEY, JSON.stringify(contacts));
}

export function listContacts(): AddressBookContact[] {
  return readStore();
}

export function addContact(name: string, publicKey: string): AddressBookContact {
  const trimmedName = name.trim();
  const trimmedKey = publicKey.trim();
  if (!trimmedName) {
    throw new AddressBookError('Contact name is required.');
  }
  if (!isValidStellarPublicKey(trimmedKey)) {
    throw new AddressBookError('Enter a valid Stellar public key (G...).');
  }
  const contacts = readStore();
  if (contacts.some((contact) => contact.publicKey === trimmedKey)) {
    throw new AddressBookError('That public key is already saved.');
  }
  const contact: AddressBookContact = {
    id: crypto.randomUUID(),
    name: trimmedName,
    publicKey: trimmedKey,
  };
  writeStore([...contacts, contact]);
  return contact;
}

export function updateContact(
  id: string,
  updates: { name?: string; publicKey?: string },
): AddressBookContact {
  const contacts = readStore();
  const index = contacts.findIndex((contact) => contact.id === id);
  if (index === -1) {
    throw new AddressBookError('Contact not found.');
  }
  const current = contacts[index];
  const name = updates.name !== undefined ? updates.name.trim() : current.name;
  const publicKey = updates.publicKey !== undefined ? updates.publicKey.trim() : current.publicKey;
  if (!name) {
    throw new AddressBookError('Contact name is required.');
  }
  if (!isValidStellarPublicKey(publicKey)) {
    throw new AddressBookError('Enter a valid Stellar public key (G...).');
  }
  if (contacts.some((contact) => contact.id !== id && contact.publicKey === publicKey)) {
    throw new AddressBookError('That public key is already saved.');
  }
  const next: AddressBookContact = { ...current, name, publicKey };
  const updated = contacts.slice();
  updated[index] = next;
  writeStore(updated);
  return next;
}

export function deleteContact(id: string): void {
  const contacts = readStore();
  const next = contacts.filter((contact) => contact.id !== id);
  if (next.length === contacts.length) {
    throw new AddressBookError('Contact not found.');
  }
  writeStore(next);
}
