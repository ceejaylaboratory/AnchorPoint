import { useState, type FormEvent } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  AddressBookError,
  addContact,
  deleteContact,
  listContacts,
  updateContact,
  type AddressBookContact,
} from '../lib/addressBook';

type Draft = {
  name: string;
  publicKey: string;
};

const emptyDraft: Draft = { name: '', publicKey: '' };

export const AddressBook = () => {
  const [contacts, setContacts] = useState<AddressBookContact[]>(() => listContacts());
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => setContacts(listContacts());

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (editingId) {
        updateContact(editingId, draft);
      } else {
        addContact(draft.name, draft.publicKey);
      }
      setDraft(emptyDraft);
      setEditingId(null);
      refresh();
    } catch (err) {
      setError(err instanceof AddressBookError ? err.message : 'Could not save contact.');
    }
  };

  const startEdit = (contact: AddressBookContact) => {
    setEditingId(contact.id);
    setDraft({ name: contact.name, publicKey: contact.publicKey });
    setError(null);
  };

  const handleDelete = (id: string) => {
    setError(null);
    try {
      deleteContact(id);
      if (editingId === id) {
        setEditingId(null);
        setDraft(emptyDraft);
      }
      refresh();
    } catch (err) {
      setError(err instanceof AddressBookError ? err.message : 'Could not delete contact.');
    }
  };

  return (
    <section className="glass-card p-8" aria-labelledby="address-book-heading">
      <h3 id="address-book-heading" className="mb-1 text-xl font-bold">
        Address book
      </h3>
      <p className="mb-4 text-sm text-slate-400">
        Save labeled Stellar public keys so you do not have to paste them each time.
      </p>

      <form onSubmit={handleSubmit} className="mb-6 grid gap-3">
        <label className="grid gap-1 text-sm text-slate-300">
          Name
          <input
            aria-label="Contact name"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          />
        </label>
        <label className="grid gap-1 text-sm text-slate-300">
          Public key
          <input
            aria-label="Stellar public key"
            value={draft.publicKey}
            onChange={(event) =>
              setDraft((current) => ({ ...current, publicKey: event.target.value }))
            }
            placeholder="G..."
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-rose-400">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button type="submit" className="action-button rounded-lg bg-primary px-4 py-2 text-sm font-semibold">
            {editingId ? 'Save contact' : 'Add contact'}
          </button>
          {editingId ? (
            <button
              type="button"
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm"
              onClick={() => {
                setEditingId(null);
                setDraft(emptyDraft);
                setError(null);
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {contacts.length === 0 ? (
        <p className="text-sm text-slate-500">No saved contacts yet.</p>
      ) : (
        <ul className="space-y-2">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-100">{contact.name}</p>
                <p className="truncate font-mono text-xs text-slate-400">{contact.publicKey}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  aria-label={`Edit ${contact.name}`}
                  onClick={() => startEdit(contact)}
                  className="rounded-lg border border-slate-700 p-2 text-slate-300"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${contact.name}`}
                  onClick={() => handleDelete(contact.id)}
                  className="rounded-lg border border-slate-700 p-2 text-rose-300"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default AddressBook;
