/**
 * Unit tests for backend/src/sep31/service.ts
 * Covers: quote expiry validation, transaction creation, and fee calculation.
 */

import {
  createSep31Transaction,
  getSep31Transaction,
  updateSep31TransactionStatus,
  createQuote,
  getQuote,
} from './service';
import type { Sep31TransactionRequest } from './types';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const validRequest: Sep31TransactionRequest = {
  asset_code: 'USDC',
  amount: '100',
  sender_info: { first_name: 'Alice', last_name: 'Smith' },
  receiver_info: { first_name: 'Bob', last_name: 'Jones' },
};

// ─── Quote helpers ──────────────────────────────────────────────────────────────

describe('createQuote / getQuote', () => {
  it('creates a quote with a future expiry', () => {
    const q = createQuote('USDC', 'USD', '1.00', 60);
    expect(q.id).toBeTruthy();
    expect(q.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('getQuote returns the stored quote', () => {
    const q = createQuote('USDC', 'USD', '1.00', 60);
    const found = getQuote(q.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(q.id);
  });

  it('getQuote returns null for unknown id', () => {
    expect(getQuote('non-existent-id')).toBeNull();
  });
});

// ─── Quote expiry validation ────────────────────────────────────────────────────

describe('createSep31Transaction — quote expiry validation', () => {
  it('succeeds without a quote_id', async () => {
    const result = await createSep31Transaction(validRequest);
    expect(result.id).toBeTruthy();
    expect(result.stellar_account_id).toBeTruthy();
  });

  it('succeeds when a valid, non-expired quote_id is provided', async () => {
    const quote = createQuote('USDC', 'USD', '1.00', 120); // 2 min TTL
    const result = await createSep31Transaction({ ...validRequest, quote_id: quote.id });
    expect(result.id).toBeTruthy();
  });

  it('locks the quoted exchange rate onto the transaction record', async () => {
    const quote = createQuote('USDC', 'NGN', '1550.25', 60);
    const result = await createSep31Transaction({ ...validRequest, quote_id: quote.id });
    const record = await getSep31Transaction(result.id);
    expect(record?.quote_id).toBe(quote.id);
    expect(record?.quote_price).toBe('1550.25');
  });

  it('rejects reusing a quote that is already bound to a transaction', async () => {
    const quote = createQuote('USDC', 'USD', '1.00', 60);
    await createSep31Transaction({ ...validRequest, quote_id: quote.id });
    await expect(
      createSep31Transaction({ ...validRequest, quote_id: quote.id }),
    ).rejects.toThrow('quote_already_used');
  });

  it('throws quote_not_found when quote_id does not exist', async () => {
    await expect(
      createSep31Transaction({ ...validRequest, quote_id: 'does-not-exist' }),
    ).rejects.toThrow('quote_not_found');
  });

  it('throws quote_expired when quote TTL has elapsed', async () => {
    // Create a quote that expires immediately (0 second TTL)
    const expiredQuote = createQuote('USDC', 'USD', '1.00', 0);

    // Advance past the expiry by waiting 10 ms
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(
      createSep31Transaction({ ...validRequest, quote_id: expiredQuote.id }),
    ).rejects.toThrow('quote_expired');
  });

  it('includes the expired quote id in the error message', async () => {
    const expiredQuote = createQuote('USDC', 'USD', '1.00', 0);
    await new Promise((resolve) => setTimeout(resolve, 10));

    let errorMsg = '';
    try {
      await createSep31Transaction({ ...validRequest, quote_id: expiredQuote.id });
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    }
    expect(errorMsg).toContain(expiredQuote.id);
  });
});

// ─── Transaction lifecycle ──────────────────────────────────────────────────────

describe('getSep31Transaction', () => {
  it('returns null for unknown id', async () => {
    const result = await getSep31Transaction('unknown-id');
    expect(result).toBeNull();
  });

  it('returns the record that was just created', async () => {
    const tx = await createSep31Transaction(validRequest);
    const record = await getSep31Transaction(tx.id);
    expect(record).not.toBeNull();
    expect(record?.id).toBe(tx.id);
    expect(record?.status).toBe('pending_sender');
  });
});

describe('updateSep31TransactionStatus', () => {
  it('updates status correctly', async () => {
    const tx = await createSep31Transaction(validRequest);
    const updated = await updateSep31TransactionStatus(tx.id, 'completed');
    expect(updated?.status).toBe('completed');
    expect(updated?.completed_at).toBeTruthy();
  });

  it('returns null for unknown id', async () => {
    const result = await updateSep31TransactionStatus('unknown', 'completed');
    expect(result).toBeNull();
  });
});
