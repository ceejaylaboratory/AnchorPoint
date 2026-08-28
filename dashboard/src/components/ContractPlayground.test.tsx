import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import {
  ContractPlayground,
  parseContractSpec,
  validateSorobanParam,
  encodeTypedValue,
  type ContractSpec,
} from './ContractPlayground';

// ─── parseContractSpec ────────────────────────────────────────────────────────

describe('parseContractSpec', () => {
  it('returns null for empty string', () => {
    expect(parseContractSpec('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseContractSpec('not json')).toBeNull();
  });

  it('returns null when JSON lacks a functions array', () => {
    expect(parseContractSpec('{"name":"foo"}')).toBeNull();
  });

  it('parses a minimal valid spec', () => {
    const spec: ContractSpec = {
      functions: [
        {
          name: 'transfer',
          params: [
            { name: 'to', type: 'Address' },
            { name: 'amount', type: 'i128' },
          ],
        },
      ],
    };
    const result = parseContractSpec(JSON.stringify(spec));
    expect(result).not.toBeNull();
    expect(result!.functions).toHaveLength(1);
    expect(result!.functions[0].name).toBe('transfer');
    expect(result!.functions[0].params[0]).toEqual({ name: 'to', type: 'Address' });
  });

  it('parses a spec with multiple functions', () => {
    const spec: ContractSpec = {
      functions: [
        { name: 'mint', params: [{ name: 'amount', type: 'u128' }] },
        { name: 'burn', params: [{ name: 'amount', type: 'u128' }] },
        { name: 'get_name', params: [] },
      ],
    };
    const result = parseContractSpec(JSON.stringify(spec));
    expect(result!.functions).toHaveLength(3);
    expect(result!.functions.map((f) => f.name)).toEqual(['mint', 'burn', 'get_name']);
  });

  it('preserves doc and returnType fields', () => {
    const spec: ContractSpec = {
      functions: [
        {
          name: 'allowance',
          params: [],
          returnType: 'i128',
          doc: 'Returns the current allowance.',
        },
      ],
    };
    const result = parseContractSpec(JSON.stringify(spec));
    expect(result!.functions[0].returnType).toBe('i128');
    expect(result!.functions[0].doc).toBe('Returns the current allowance.');
  });
});

// ─── validateSorobanParam ─────────────────────────────────────────────────────

describe('validateSorobanParam', () => {
  it('returns an error for empty values regardless of type', () => {
    expect(validateSorobanParam('Address', '')).toBeTruthy();
    expect(validateSorobanParam('i128', '')).toBeTruthy();
    expect(validateSorobanParam('Symbol', '')).toBeTruthy();
  });

  describe('Address', () => {
    it('accepts valid G-address', () => {
      expect(
        validateSorobanParam('Address', 'GABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZ'),
      ).toBeNull();
    });

    it('accepts valid C-address', () => {
      expect(
        validateSorobanParam('Address', 'CABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZ'),
      ).toBeNull();
    });

    it('rejects address that is too short', () => {
      expect(validateSorobanParam('Address', 'GABCDEF')).toBeTruthy();
    });

    it('rejects address starting with an invalid letter', () => {
      expect(
        validateSorobanParam('Address', 'XABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZ'),
      ).toBeTruthy();
    });
  });

  describe('Symbol', () => {
    it('accepts valid symbol', () => {
      expect(validateSorobanParam('Symbol', 'transfer_tokens')).toBeNull();
    });

    it('rejects symbol starting with a digit', () => {
      expect(validateSorobanParam('Symbol', '1bad')).toBeTruthy();
    });

    it('rejects symbol longer than 32 characters', () => {
      expect(validateSorobanParam('Symbol', 'a'.repeat(33))).toBeTruthy();
    });

    it('accepts symbol of exactly 32 characters', () => {
      expect(validateSorobanParam('Symbol', 'a'.repeat(32))).toBeNull();
    });
  });

  describe('Bool', () => {
    it('accepts "true"', () => {
      expect(validateSorobanParam('Bool', 'true')).toBeNull();
    });

    it('accepts "false"', () => {
      expect(validateSorobanParam('Bool', 'false')).toBeNull();
    });

    it('rejects arbitrary strings', () => {
      expect(validateSorobanParam('Bool', 'yes')).toBeTruthy();
      expect(validateSorobanParam('Bool', '1')).toBeTruthy();
    });
  });

  describe('i32 / u32', () => {
    it('accepts integers within range', () => {
      expect(validateSorobanParam('i32', '2147483647')).toBeNull();
      expect(validateSorobanParam('u32', '0')).toBeNull();
    });

    it('rejects i32 out of range', () => {
      expect(validateSorobanParam('i32', '2147483648')).toBeTruthy();
    });

    it('rejects u32 negative value', () => {
      expect(validateSorobanParam('u32', '-1')).toBeTruthy();
    });

    it('rejects non-integer', () => {
      expect(validateSorobanParam('i32', '3.14')).toBeTruthy();
    });
  });

  describe('i64 / u64', () => {
    it('accepts valid i64', () => {
      expect(validateSorobanParam('i64', '9223372036854775807')).toBeNull();
    });

    it('rejects u64 negative value', () => {
      expect(validateSorobanParam('u64', '-1')).toBeTruthy();
    });

    it('rejects non-numeric string', () => {
      expect(validateSorobanParam('i64', 'abc')).toBeTruthy();
    });
  });

  describe('i128 / u128', () => {
    it('accepts large positive i128', () => {
      expect(
        validateSorobanParam('i128', '170141183460469231731687303715884105727'),
      ).toBeNull();
    });

    it('accepts negative i128', () => {
      expect(validateSorobanParam('i128', '-100')).toBeNull();
    });

    it('rejects u128 negative value', () => {
      expect(validateSorobanParam('u128', '-1')).toBeTruthy();
    });

    it('rejects non-numeric string', () => {
      expect(validateSorobanParam('i128', 'not_a_number')).toBeTruthy();
    });
  });

  describe('Vec / Map', () => {
    it('accepts valid JSON array for Vec', () => {
      expect(validateSorobanParam('Vec', '["a","b","c"]')).toBeNull();
    });

    it('rejects invalid JSON for Vec', () => {
      expect(validateSorobanParam('Vec', 'not json')).toBeTruthy();
    });

    it('accepts valid JSON object for Map', () => {
      expect(validateSorobanParam('Map', '{"key":"value"}')).toBeNull();
    });

    it('rejects invalid JSON for Map', () => {
      expect(validateSorobanParam('Map', '{bad}')).toBeTruthy();
    });
  });

  describe('String / Bytes', () => {
    it('accepts any non-empty value', () => {
      expect(validateSorobanParam('String', 'hello world')).toBeNull();
      expect(validateSorobanParam('Bytes', '0xdeadbeef')).toBeNull();
    });
  });
});

// ─── encodeTypedValue smoke tests ─────────────────────────────────────────────

describe('encodeTypedValue', () => {
  it('encodes Bool true', () => {
    const val = encodeTypedValue('Bool', 'true');
    expect(val.switch().name).toBe('scvBool');
  });

  it('encodes Bool false', () => {
    const val = encodeTypedValue('Bool', 'false');
    expect(val.switch().name).toBe('scvBool');
  });

  it('encodes i32', () => {
    const val = encodeTypedValue('i32', '42');
    expect(val.switch().name).toBe('scvI32');
  });

  it('encodes u32', () => {
    const val = encodeTypedValue('u32', '100');
    expect(val.switch().name).toBe('scvU32');
  });

  it('encodes i64', () => {
    const val = encodeTypedValue('i64', '9000000000');
    expect(val.switch().name).toBe('scvI64');
  });

  it('encodes Symbol', () => {
    const val = encodeTypedValue('Symbol', 'transfer');
    expect(val.switch().name).toBe('scvSymbol');
  });

  it('encodes String', () => {
    const val = encodeTypedValue('String', 'hello');
    expect(val.switch().name).toBe('scvString');
  });

  it('encodes Vec from JSON array', () => {
    const val = encodeTypedValue('Vec', '["a","b"]');
    expect(val.switch().name).toBe('scvVec');
  });

  it('encodes Map from JSON object', () => {
    const val = encodeTypedValue('Map', '{"foo":"bar"}');
    expect(val.switch().name).toBe('scvMap');
  });
});

// ─── ContractPlayground component ─────────────────────────────────────────────

const VALID_SPEC = JSON.stringify({
  functions: [
    {
      name: 'transfer',
      params: [
        { name: 'to', type: 'Address' },
        { name: 'amount', type: 'i128' },
      ],
      returnType: 'Bool',
      doc: 'Transfers tokens to the given address.',
    },
    {
      name: 'get_name',
      params: [],
      returnType: 'Symbol',
    },
  ],
});

describe('ContractPlayground component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in legacy mode when no spec is provided', () => {
    render(<ContractPlayground />);
    expect(screen.getByText(/Soroban contract playground/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Function name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Arguments JSON array/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Simulate call/i })).toBeInTheDocument();
  });

  it('renders spec JSON textarea', () => {
    render(<ContractPlayground />);
    expect(screen.getByLabelText(/Contract spec JSON/i)).toBeInTheDocument();
  });

  it('shows an error when invalid spec JSON is entered', () => {
    render(<ContractPlayground />);
    const specArea = screen.getByLabelText(/Contract spec JSON/i);
    fireEvent.change(specArea, { target: { value: 'not valid json' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid contract spec JSON/i);
  });

  it('switches to dynamic mode when a valid spec is provided', () => {
    render(<ContractPlayground initialSpecJson={VALID_SPEC} />);
    // Function selector should be visible
    expect(screen.getByLabelText(/Select function/i)).toBeInTheDocument();
    // First function params should render
    expect(screen.getByLabelText(/to \(Address\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount \(i128\)/i)).toBeInTheDocument();
    // Legacy inputs should NOT be visible
    expect(screen.queryByLabelText(/Function name/i)).toBeNull();
    expect(screen.queryByLabelText(/Arguments JSON array/i)).toBeNull();
  });

  it('shows doc text for selected function', () => {
    render(<ContractPlayground initialSpecJson={VALID_SPEC} />);
    // The doc is rendered as a <p> element; use getAllByText to handle the textarea also containing the spec JSON
    const matches = screen.getAllByText(/Transfers tokens to the given address\./i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // At least one should be a paragraph element (the actual doc text, not the spec JSON textarea value)
    const pElement = matches.find((el) => el.tagName === 'P');
    expect(pElement).toBeInTheDocument();
  });

  it('switches function when selector changes', () => {
    render(<ContractPlayground initialSpecJson={VALID_SPEC} />);
    const selector = screen.getByLabelText(/Select function/i);
    fireEvent.change(selector, { target: { value: 'get_name' } });
    // get_name has no params
    expect(screen.queryByLabelText(/to \(Address\)/i)).toBeNull();
    expect(screen.queryByLabelText(/amount \(i128\)/i)).toBeNull();
    expect(screen.getByText(/This function takes no parameters\./i)).toBeInTheDocument();
  });

  it('shows param type badges', () => {
    render(<ContractPlayground initialSpecJson={VALID_SPEC} />);
    expect(screen.getByText('Address')).toBeInTheDocument();
    expect(screen.getByText('i128')).toBeInTheDocument();
  });

  it('shows inline validation error on submit with empty Address', async () => {
    render(<ContractPlayground initialSpecJson={VALID_SPEC} />);

    // Leave all params empty
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Simulate call/i }));
    });

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0]).toHaveTextContent(/required/i);
  });

  it('shows validation error for invalid Address', async () => {
    render(<ContractPlayground initialSpecJson={VALID_SPEC} />);

    const toInput = screen.getByLabelText(/to \(Address\)/i);
    fireEvent.change(toInput, { target: { value: 'not-an-address' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Simulate call/i }));
    });

    const alerts = screen.getAllByRole('alert');
    const addressAlert = alerts.find((a) =>
      /valid Stellar address/i.test(a.textContent ?? ''),
    );
    expect(addressAlert).toBeInTheDocument();
  });

  it('clears param error when user corrects the value', async () => {
    render(<ContractPlayground initialSpecJson={VALID_SPEC} />);

    const toInput = screen.getByLabelText(/to \(Address\)/i);
    fireEvent.change(toInput, { target: { value: 'bad' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Simulate call/i }));
    });

    // Error appears
    expect(screen.queryAllByRole('alert').length).toBeGreaterThan(0);

    // Now correct it to a valid address
    fireEvent.change(toInput, {
      target: {
        value: 'GABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZ',
      },
    });

    // Address-specific error should be gone for this field
    await waitFor(() => {
      const alerts = screen.queryAllByRole('alert');
      const addressError = alerts.find((a) =>
        /valid Stellar address/i.test(a.textContent ?? ''),
      );
      expect(addressError).toBeUndefined();
    });
  });

  it('renders Bool parameter as a select element', () => {
    const boolSpec = JSON.stringify({
      functions: [
        {
          name: 'set_flag',
          params: [{ name: 'enabled', type: 'Bool' }],
        },
      ],
    });
    render(<ContractPlayground initialSpecJson={boolSpec} />);
    const boolSelect = screen.getByLabelText(/enabled \(Bool\)/i);
    expect(boolSelect.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: /true/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /false/i })).toBeInTheDocument();
  });

  it('renders Vec parameter as a textarea', () => {
    const vecSpec = JSON.stringify({
      functions: [
        {
          name: 'batch',
          params: [{ name: 'items', type: 'Vec' }],
        },
      ],
    });
    render(<ContractPlayground initialSpecJson={vecSpec} />);
    const vecInput = screen.getByLabelText(/items \(Vec\)/i);
    expect(vecInput.tagName).toBe('TEXTAREA');
  });

  it('renders Map parameter as a textarea', () => {
    const mapSpec = JSON.stringify({
      functions: [
        {
          name: 'set_map',
          params: [{ name: 'data', type: 'Map' }],
        },
      ],
    });
    render(<ContractPlayground initialSpecJson={mapSpec} />);
    const mapInput = screen.getByLabelText(/data \(Map\)/i);
    expect(mapInput.tagName).toBe('TEXTAREA');
  });

  it('shows the result panel placeholder initially', () => {
    render(<ContractPlayground />);
    expect(
      screen.getByText(/Run a simulation to inspect the decoded return value\./i),
    ).toBeInTheDocument();
  });

  it('shows an error when backend is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    render(<ContractPlayground initialSpecJson={VALID_SPEC} />);

    // Fill in required params to pass validation
    fireEvent.change(screen.getByLabelText(/to \(Address\)/i), {
      target: {
        value: 'GABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZ',
      },
    });
    fireEvent.change(screen.getByLabelText(/amount \(i128\)/i), {
      target: { value: '1000' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Simulate call/i }));
    });

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/Network error/i);
    });
  });

  it('shows "Simulating…" text while loading', async () => {
    // Never resolves
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(<ContractPlayground initialSpecJson={VALID_SPEC} />);

    fireEvent.change(screen.getByLabelText(/to \(Address\)/i), {
      target: {
        value: 'GABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZGABC2XYZ',
      },
    });
    fireEvent.change(screen.getByLabelText(/amount \(i128\)/i), {
      target: { value: '500' },
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Simulate call/i }));
    });

    expect(
      await screen.findByRole('button', { name: /Simulating…/i }),
    ).toBeDisabled();
  });

  it('resets dynamic params when a different function is selected', () => {
    const spec = JSON.stringify({
      functions: [
        {
          name: 'fn_a',
          params: [{ name: 'x', type: 'i32' }],
        },
        {
          name: 'fn_b',
          params: [{ name: 'y', type: 'Symbol' }],
        },
      ],
    });
    render(<ContractPlayground initialSpecJson={spec} />);

    // Fill in fn_a's x
    fireEvent.change(screen.getByLabelText(/x \(i32\)/i), {
      target: { value: '42' },
    });

    // Switch to fn_b
    fireEvent.change(screen.getByLabelText(/Select function/i), {
      target: { value: 'fn_b' },
    });

    // fn_b's y should be empty
    expect(screen.getByLabelText(/y \(Symbol\)/i)).toHaveValue('');
  });
});
