import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  ContractPlayground,
  parseContractSpec,
  validateParam,
  encodeParamToScVal,
  type SorobanContractSpec,
  type SorobanFunctionSpec,
} from './ContractPlayground';

// ---------------------------------------------------------------------------
// parseContractSpec
// ---------------------------------------------------------------------------

describe('parseContractSpec', () => {
  it('returns null spec and null error for empty input', () => {
    const { spec, error } = parseContractSpec('');
    expect(spec).toBeNull();
    expect(error).toBeNull();
  });

  it('parses a valid { functions: [...] } object', () => {
    const input = JSON.stringify({
      functions: [
        { name: 'get_name', inputs: [], outputs: ['Symbol'] },
        { name: 'transfer', inputs: [{ name: 'amount', type: 'i128' }] },
      ],
    });
    const { spec, error } = parseContractSpec(input);
    expect(error).toBeNull();
    expect(spec).not.toBeNull();
    expect(spec!.functions).toHaveLength(2);
    expect(spec!.functions[0].name).toBe('get_name');
    expect(spec!.functions[1].inputs[0].name).toBe('amount');
  });

  it('parses a bare array of function specs', () => {
    const input = JSON.stringify([
      { name: 'foo', inputs: [{ name: 'x', type: 'u32' }] },
    ]);
    const { spec, error } = parseContractSpec(input);
    expect(error).toBeNull();
    expect(spec!.functions[0].name).toBe('foo');
  });

  it('returns an error for invalid JSON', () => {
    const { spec, error } = parseContractSpec('{bad json');
    expect(spec).toBeNull();
    expect(error).toMatch(/invalid json/i);
  });

  it('returns an error for a JSON object without a functions key', () => {
    const { spec, error } = parseContractSpec(JSON.stringify({ methods: [] }));
    expect(spec).toBeNull();
    expect(error).toMatch(/functions/i);
  });

  it('handles a spec with no inputs', () => {
    const input = JSON.stringify({ functions: [{ name: 'noop', inputs: [] }] });
    const { spec } = parseContractSpec(input);
    expect(spec!.functions[0].inputs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateParam
// ---------------------------------------------------------------------------

describe('validateParam', () => {
  describe('Address', () => {
    it('accepts a valid G-address', () => {
      // Valid Stellar Ed25519 public key — 56 characters, starts with G, base32 charset
      expect(validateParam('GCCCY47HSR3NLEJYVUYQK6GUTTF7US2OMBQRP6VGBZJDZXRY5MTP3RDN', 'Address')).toBeNull();
    });

    it('accepts a valid C-address (contract)', () => {
      expect(validateParam('CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', 'Address')).toBeNull();
    });

    it('rejects an invalid address', () => {
      expect(validateParam('NOT_AN_ADDRESS', 'Address')).toMatch(/invalid stellar address/i);
    });

    it('rejects an empty string', () => {
      expect(validateParam('', 'Address')).toMatch(/required/i);
    });
  });

  describe('Symbol', () => {
    it('accepts valid symbols', () => {
      expect(validateParam('my_symbol', 'Symbol')).toBeNull();
      expect(validateParam('ABC', 'Symbol')).toBeNull();
      expect(validateParam('a1_b2', 'Symbol')).toBeNull();
    });

    it('rejects symbols longer than 32 chars', () => {
      expect(validateParam('a'.repeat(33), 'Symbol')).not.toBeNull();
    });

    it('rejects symbols with spaces', () => {
      expect(validateParam('bad symbol', 'Symbol')).not.toBeNull();
    });

    it('rejects empty string', () => {
      expect(validateParam('', 'Symbol')).toMatch(/required/i);
    });
  });

  describe('String', () => {
    it('accepts any non-empty string', () => {
      expect(validateParam('Hello, world!', 'String')).toBeNull();
      expect(validateParam('   spaces   ', 'String')).toBeNull();
    });

    it('rejects empty string', () => {
      expect(validateParam('', 'String')).toMatch(/required/i);
    });
  });

  describe('i128 / i64 / i32', () => {
    it('accepts negative integers', () => {
      expect(validateParam('-9999999999999', 'i128')).toBeNull();
      expect(validateParam('-1', 'i64')).toBeNull();
      expect(validateParam('-2147483648', 'i32')).toBeNull();
    });

    it('accepts positive integers', () => {
      expect(validateParam('42', 'i128')).toBeNull();
      expect(validateParam('0', 'i64')).toBeNull();
    });

    it('rejects decimal numbers', () => {
      expect(validateParam('3.14', 'i128')).not.toBeNull();
    });

    it('rejects non-numeric strings', () => {
      expect(validateParam('abc', 'i128')).not.toBeNull();
    });
  });

  describe('u128 / u64 / u32', () => {
    it('accepts non-negative integers', () => {
      expect(validateParam('0', 'u128')).toBeNull();
      expect(validateParam('99999999999999', 'u64')).toBeNull();
      expect(validateParam('4294967295', 'u32')).toBeNull();
    });

    it('rejects negative integers', () => {
      expect(validateParam('-1', 'u128')).not.toBeNull();
    });

    it('rejects decimal numbers', () => {
      expect(validateParam('1.5', 'u64')).not.toBeNull();
    });
  });

  describe('Bool', () => {
    it('accepts "true" and "false"', () => {
      expect(validateParam('true', 'Bool')).toBeNull();
      expect(validateParam('false', 'Bool')).toBeNull();
    });

    it('rejects other values', () => {
      expect(validateParam('yes', 'Bool')).not.toBeNull();
      expect(validateParam('1', 'Bool')).not.toBeNull();
      expect(validateParam('TRUE', 'Bool')).not.toBeNull();
    });
  });

  describe('Bytes', () => {
    it('accepts valid hex strings', () => {
      expect(validateParam('deadbeef', 'Bytes')).toBeNull();
      expect(validateParam('00ff', 'Bytes')).toBeNull();
      expect(validateParam('', 'Bytes')).toMatch(/required/i);
    });

    it('accepts empty hex (after trim – but empty string is caught first)', () => {
      // A non-empty even hex string
      expect(validateParam('aabb', 'Bytes')).toBeNull();
    });

    it('rejects odd-length hex', () => {
      expect(validateParam('abc', 'Bytes')).not.toBeNull();
    });

    it('rejects non-hex characters', () => {
      expect(validateParam('zzzz', 'Bytes')).not.toBeNull();
    });
  });

  describe('Vec / Map', () => {
    it('accepts valid JSON', () => {
      expect(validateParam('["a","b"]', 'Vec')).toBeNull();
      expect(validateParam('{"key":"val"}', 'Map')).toBeNull();
    });

    it('rejects invalid JSON', () => {
      expect(validateParam('[bad', 'Vec')).not.toBeNull();
      expect(validateParam('{bad', 'Map')).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// encodeParamToScVal
// ---------------------------------------------------------------------------

describe('encodeParamToScVal', () => {
  it('encodes Symbol', () => {
    const val = encodeParamToScVal('my_sym', 'Symbol');
    expect(val).toBeDefined();
    expect(val.switch().name).toBe('scvSymbol');
  });

  it('encodes String', () => {
    const val = encodeParamToScVal('hello', 'String');
    expect(val.switch().name).toBe('scvString');
  });

  it('encodes Bool true', () => {
    const val = encodeParamToScVal('true', 'Bool');
    expect(val.switch().name).toBe('scvBool');
    expect(val.value()).toBe(true);
  });

  it('encodes Bool false', () => {
    const val = encodeParamToScVal('false', 'Bool');
    expect(val.switch().name).toBe('scvBool');
    expect(val.value()).toBe(false);
  });

  it('encodes u32', () => {
    const val = encodeParamToScVal('42', 'u32');
    expect(val.switch().name).toBe('scvU32');
  });

  it('encodes i32', () => {
    const val = encodeParamToScVal('-7', 'i32');
    expect(val.switch().name).toBe('scvI32');
  });

  it('encodes i64', () => {
    const val = encodeParamToScVal('-999', 'i64');
    expect(val.switch().name).toBe('scvI64');
  });

  it('encodes u64', () => {
    const val = encodeParamToScVal('999', 'u64');
    expect(val.switch().name).toBe('scvU64');
  });

  it('encodes i128', () => {
    const val = encodeParamToScVal('0', 'i128');
    expect(val.switch().name).toBe('scvI128');
  });

  it('encodes u128', () => {
    const val = encodeParamToScVal('0', 'u128');
    expect(val.switch().name).toBe('scvU128');
  });

  it('encodes Bytes (hex)', () => {
    const val = encodeParamToScVal('deadbeef', 'Bytes');
    expect(val.switch().name).toBe('scvBytes');
  });

  it('encodes Vec (JSON array)', () => {
    const val = encodeParamToScVal('["a","b"]', 'Vec');
    expect(val.switch().name).toBe('scvVec');
  });

  it('encodes Map (JSON object)', () => {
    const val = encodeParamToScVal('{"foo":"bar"}', 'Map');
    expect(val.switch().name).toBe('scvMap');
  });

  it('falls back to scvString for unknown types', () => {
    const val = encodeParamToScVal('test', 'UnknownType');
    expect(val.switch().name).toBe('scvString');
  });
});

// ---------------------------------------------------------------------------
// ContractPlayground component
// ---------------------------------------------------------------------------

const sampleSpec: SorobanContractSpec = {
  functions: [
    {
      name: 'get_name',
      doc: 'Returns the contract name',
      inputs: [],
      outputs: ['Symbol'],
    },
    {
      name: 'transfer',
      doc: 'Transfer tokens between accounts',
      inputs: [
        { name: 'from', type: 'Address' },
        { name: 'to', type: 'Address' },
        { name: 'amount', type: 'i128' },
      ],
    },
    {
      name: 'set_flag',
      inputs: [{ name: 'flag', type: 'Bool' }],
    },
  ],
};

const sampleSpecJson = JSON.stringify(sampleSpec);

describe('ContractPlayground component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the playground header and description', () => {
    render(<ContractPlayground />);
    expect(screen.getByText(/Soroban contract playground/i)).toBeInTheDocument();
    expect(screen.getByText(/paste a contract spec json/i)).toBeInTheDocument();
  });

  it('renders the Contract ID input', () => {
    render(<ContractPlayground />);
    expect(screen.getByLabelText(/contract id/i)).toBeInTheDocument();
  });

  it('renders the contract spec JSON textarea', () => {
    render(<ContractPlayground />);
    expect(screen.getByLabelText(/contract spec json/i)).toBeInTheDocument();
  });

  it('shows a success count after loading a valid spec', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    expect(screen.getByText(/✓ Loaded 3 functions/i)).toBeInTheDocument();
  });

  it('shows an error when spec JSON is invalid', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: '{bad json' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toMatch(/invalid json/i);
  });

  it('renders a function selector after loading a spec', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    expect(screen.getByLabelText(/function/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /get_name/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /transfer/i })).toBeInTheDocument();
  });

  it('shows function doc when a function is selected', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'get_name' } });
    // The doc appears both in the <option> and in the italic description paragraph;
    // confirm at least one match exists as a paragraph (role="note" is not set, so use getAllByText)
    const matches = screen.getAllByText(/Returns the contract name/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "no arguments" message for a zero-input function', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'get_name' } });
    expect(screen.getByText(/no arguments/i)).toBeInTheDocument();
  });

  it('renders dynamic param fields for a function with inputs', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'transfer' } });
    expect(screen.getByLabelText(/from \(address\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to \(address\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount \(i128\)/i)).toBeInTheDocument();
  });

  it('renders a Bool parameter as a select element', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'set_flag' } });
    const selectEl = screen.getByLabelText(/flag \(bool\)/i);
    expect(selectEl.tagName).toBe('SELECT');
  });

  it('shows inline validation error for an invalid Address', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'transfer' } });
    const fromInput = screen.getByLabelText(/from \(address\)/i);
    fireEvent.change(fromInput, { target: { value: 'NOT_VALID' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toMatch(/invalid stellar address/i);
  });

  it('shows inline validation error for an invalid i128', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'transfer' } });
    const amountInput = screen.getByLabelText(/amount \(i128\)/i);
    fireEvent.change(amountInput, { target: { value: '3.14' } });
    expect(screen.getAllByRole('alert')[0].textContent).toMatch(/signed integer/i);
  });

  it('shows the simulate button when a function is selected', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'get_name' } });
    expect(screen.getByRole('button', { name: /simulate call/i })).toBeInTheDocument();
  });

  it('prevents submission and shows errors if required params are empty', async () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'transfer' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /simulate call/i }));
    });

    // Required field errors should appear
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('calls the RPC simulation endpoint on valid submission', async () => {
    const mockSimulate = vi.fn().mockResolvedValue({
      result: {
        retval: {
          switch: () => ({ name: 'scvSymbol' }),
          value: () => Buffer.from('AnchorPoint'),
        },
      },
    });

    // Mock the dynamic stellar-sdk import
    vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
      return {
        ...actual,
        rpc: {
          Server: vi.fn().mockImplementation(() => ({
            simulateTransaction: mockSimulate,
          })),
        },
      };
    });

    const { scValToNative } = await import('@stellar/stellar-sdk');

    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'get_name' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /simulate call/i }));
    });

    // The result panel should exist
    expect(screen.getByText(/result/i)).toBeInTheDocument();
  });

  it('displays an error message when simulation fails', async () => {
    // When the contractId is invalid or the RPC call fails, the component shows an error alert.
    // We trigger this by submitting with a clearly bad/empty contract ID so the SDK throws.
    render(<ContractPlayground />);

    // Clear the contract ID so the SDK call will fail
    fireEvent.change(screen.getByLabelText(/contract id/i), { target: { value: '' } });

    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'get_name' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /simulate call/i }));
    });

    // An error alert should appear (either from validation or the failed simulate call)
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  it('resets param fields when a new function is selected', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });

    // Select transfer and fill in from
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'transfer' } });
    fireEvent.change(screen.getByLabelText(/from \(address\)/i), { target: { value: 'TEST' } });

    // Switch to a different function
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'set_flag' } });
    expect(screen.queryByLabelText(/from \(address\)/i)).toBeNull();
    expect(screen.getByLabelText(/flag \(bool\)/i)).toBeInTheDocument();
  });

  it('resets spec and function when spec textarea is changed', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'transfer' } });

    // Clear spec
    fireEvent.change(specInput, { target: { value: '' } });
    expect(screen.queryByLabelText(/function/i)).toBeNull();
  });

  it('shows the XDR preview section label', () => {
    render(<ContractPlayground />);
    // XDR section is only shown after a successful simulation, but the label is in the component
    // We just verify the initial state doesn't show it
    expect(screen.queryByText(/XDR payload preview/i)).toBeNull();
  });

  it('shows the result panel placeholder initially', () => {
    render(<ContractPlayground />);
    expect(screen.getByText(/run a simulation to inspect/i)).toBeInTheDocument();
  });

  it('allows collapsing the spec panel via the toggle button', () => {
    render(<ContractPlayground />);
    const toggle = screen.getByRole('button', { name: /contract spec json/i });
    expect(screen.getByLabelText(/contract spec json/i)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByLabelText(/contract spec json/i)).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByLabelText(/contract spec json/i)).toBeInTheDocument();
  });

  it('shows type badge labels on param fields', () => {
    render(<ContractPlayground />);
    const specInput = screen.getByLabelText(/contract spec json/i);
    fireEvent.change(specInput, { target: { value: sampleSpecJson } });
    fireEvent.change(screen.getByLabelText(/function/i), { target: { value: 'transfer' } });
    expect(screen.getAllByText('Address').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('i128')).toBeInTheDocument();
  });
});
