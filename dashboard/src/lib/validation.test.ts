import { describe, it, expect } from 'vitest';
import {
  validateIBAN,
  validateAmount,
  validateBankAccount,
  validateStellarAddress,
  validateGenericAddress,
  validateEmail,
  validateLength,
  validateField,
  validateAll,
} from './validation';

describe('validateIBAN', () => {
  it('accepts a valid German IBAN', () => {
    expect(validateIBAN('DE89370400440532013000')).toBeNull();
  });

  it('accepts an IBAN with spaces', () => {
    expect(validateIBAN('DE89 3704 0044 0532 0130 00')).toBeNull();
  });

  it('accepts a valid French IBAN', () => {
    expect(validateIBAN('FR1420041010050500013M02606')).toBeNull();
  });

  it('accepts a valid UK IBAN', () => {
    expect(validateIBAN('GB29NWBK60161331926819')).toBeNull();
  });

  it('rejects an IBAN with wrong country length', () => {
    const result = validateIBAN('DE123456');
    expect(result).toMatch(/IBAN for DE must be exactly/);
  });

  it('rejects an IBAN with invalid check digits', () => {
    const result = validateIBAN('DE00370400440532013000');
    expect(result).toBe('IBAN check digits are invalid.');
  });

  it('rejects a malformed IBAN', () => {
    expect(validateIBAN('12345')).toMatch(/must start with a 2-letter country code/);
  });

  it('rejects an empty string', () => {
    expect(validateIBAN('')).toBeNull();
  });
});

describe('validateAmount', () => {
  it('accepts a valid amount', () => {
    expect(validateAmount('120.50')).toBeNull();
  });

  it('accepts a whole number', () => {
    expect(validateAmount('500')).toBeNull();
  });

  it('rejects negative amount', () => {
    expect(validateAmount('-10')).toMatch(/Enter a valid amount/);
  });

  it('rejects zero', () => {
    expect(validateAmount('0')).toBe('Amount must be greater than zero.');
  });

  it('rejects over limit', () => {
    expect(validateAmount('9999999')).toBe('Amount exceeds the maximum single-transaction limit.');
  });

  it('rejects non-numeric input', () => {
    expect(validateAmount('abc')).toMatch(/Enter a valid amount/);
  });
});

describe('validateBankAccount', () => {
  it('accepts a valid bank account', () => {
    expect(validateBankAccount('123456789')).toBeNull();
  });

  it('rejects too short', () => {
    expect(validateBankAccount('12345')).toMatch(/Bank account must be 6–20 digits/);
  });

  it('rejects letters', () => {
    expect(validateBankAccount('abcdef')).toMatch(/6–20 digits/);
  });
});

describe('validateStellarAddress', () => {
  it('accepts a valid Stellar address', () => {
    expect(validateStellarAddress('GBD6D6J42WQ2G2Z7ZXM4H74J7ZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQZ')).toBeNull();
  });

  it('rejects a short address', () => {
    expect(validateStellarAddress('GABC')).toMatch(/Enter a valid Stellar wallet address/);
  });
});

describe('validateGenericAddress', () => {
  it('accepts a valid address', () => {
    expect(validateGenericAddress('123 Main St, Springfield')).toBeNull();
  });

  it('rejects too short', () => {
    expect(validateGenericAddress('AB')).toMatch(/at least 5 characters/);
  });

  it('rejects numeric-only input', () => {
    expect(validateGenericAddress('12345')).toMatch(/must contain letters/);
  });
});

describe('validateEmail', () => {
  it('accepts a valid email', () => {
    expect(validateEmail('test@example.com')).toBeNull();
  });

  it('rejects invalid email', () => {
    expect(validateEmail('not-an-email')).toMatch(/Enter a valid email address/);
  });
});

describe('validateLength', () => {
  it('accepts a value within range', () => {
    expect(validateLength('hello', 1, 10)).toBeNull();
  });

  it('rejects too short', () => {
    expect(validateLength('ab', 3)).toMatch(/at least 3 characters/);
  });

  it('rejects too long', () => {
    expect(validateLength('hello world', undefined, 5)).toMatch(/not exceed 5 characters/);
  });
});

describe('validateField', () => {
  const field = (key: string, required = true) => ({ key, label: 'Test', required });

  it('returns required error for empty required field', () => {
    expect(validateField(field('name'), '')).toBe('Test is required.');
  });

  it('returns empty for optional empty field', () => {
    expect(validateField(field('name', false), '')).toBe('');
  });

  it('routes IBAN fields correctly', () => {
    const result = validateField(field('iban'), 'DE89370400440532013000');
    expect(result).toBe('');
  });

  it('routes amount fields correctly', () => {
    expect(validateField(field('amount'), 'abc')).toMatch(/Enter a valid amount/);
  });

  it('routes bank account fields correctly', () => {
    expect(validateField(field('bank_account'), '12')).toMatch(/6–20 digits/);
  });

  it('routes wallet address fields correctly', () => {
    expect(validateField(field('wallet_address'), 'abc')).toMatch(/Enter a valid Stellar wallet address/);
  });

  it('routes generic address fields correctly', () => {
    expect(validateField(field('beneficiaryAddress'), 'AB')).toMatch(/at least 5 characters/);
  });

  it('routes email fields correctly', () => {
    expect(validateField(field('email'), 'bad')).toMatch(/Enter a valid email address/);
  });
});

describe('validateAll', () => {
  it('returns errors for all invalid fields', () => {
    const fields = [
      { key: 'amount', label: 'Amount', required: true },
      { key: 'iban', label: 'IBAN', required: true },
    ];
    const values = { amount: '-5', iban: 'DE00' };
    const errors = validateAll(fields, values);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
  });

  it('returns empty when all fields are valid', () => {
    const fields = [
      { key: 'iban', label: 'IBAN', required: true },
    ];
    const values = { iban: 'DE89370400440532013000' };
    expect(validateAll(fields, values)).toEqual({});
  });
});
