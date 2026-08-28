import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Code2, Play, Sparkles, TerminalSquare } from 'lucide-react';
import { Contract, scValToNative, xdr } from '@stellar/stellar-sdk';

// ─── Soroban contract spec types ──────────────────────────────────────────────

export type SorobanParamType =
  | 'Address'
  | 'Symbol'
  | 'String'
  | 'Bool'
  | 'i32'
  | 'i64'
  | 'i128'
  | 'u32'
  | 'u64'
  | 'u128'
  | 'Bytes'
  | 'Vec'
  | 'Map'
  | string; // allow arbitrary extension types

export interface ContractFunctionParam {
  /** Parameter name as declared in the contract */
  name: string;
  /** Soroban type string */
  type: SorobanParamType;
}

export interface ContractFunctionSpec {
  /** Contract function name */
  name: string;
  /** Ordered list of input parameters */
  params: ContractFunctionParam[];
  /** Optional return type description */
  returnType?: string;
  /** Optional human-readable description */
  doc?: string;
}

export interface ContractSpec {
  contractId?: string;
  functions: ContractFunctionSpec[];
}

// ─── Validation helpers ────────────────────────────────────────────────────────

const STELLAR_ADDRESS_RE = /^[GC][A-Z0-9]{55}$/;

/**
 * Validate a value string against a Soroban parameter type.
 * Returns null when valid, or an error message string.
 */
export function validateSorobanParam(type: SorobanParamType, value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) return `Value is required.`;

  switch (type) {
    case 'Address':
      if (!STELLAR_ADDRESS_RE.test(trimmed)) {
        return 'Must be a valid Stellar address starting with G or C (56 characters).';
      }
      return null;

    case 'Symbol':
      if (trimmed.length > 32) return 'Symbol must be ≤ 32 characters.';
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
        return 'Symbol must start with a letter or underscore, followed by alphanumeric characters or underscores.';
      }
      return null;

    case 'String':
    case 'Bytes':
      return null; // any string is acceptable

    case 'Bool':
      if (trimmed !== 'true' && trimmed !== 'false') {
        return 'Must be "true" or "false".';
      }
      return null;

    case 'i32':
    case 'u32': {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || String(n) !== trimmed) return `Must be a whole integer.`;
      if (type === 'u32' && n < 0) return 'Must be a non-negative integer.';
      if (type === 'i32' && (n < -2147483648 || n > 2147483647)) return 'Out of i32 range.';
      if (type === 'u32' && (n < 0 || n > 4294967295)) return 'Out of u32 range.';
      return null;
    }

    case 'i64':
    case 'u64': {
      try {
        const b = BigInt(trimmed);
        if (type === 'u64' && b < 0n) return 'Must be non-negative for u64.';
        if (type === 'i64' && (b < -(2n ** 63n) || b > 2n ** 63n - 1n)) return 'Out of i64 range.';
        if (type === 'u64' && b > 2n ** 64n - 1n) return 'Out of u64 range.';
        return null;
      } catch {
        return `Must be a valid integer for ${type}.`;
      }
    }

    case 'i128':
    case 'u128': {
      try {
        const b = BigInt(trimmed);
        if (type === 'u128' && b < 0n) return 'Must be non-negative for u128.';
        if (type === 'i128' && (b < -(2n ** 127n) || b > 2n ** 127n - 1n)) return 'Out of i128 range.';
        if (type === 'u128' && b > 2n ** 128n - 1n) return 'Out of u128 range.';
        return null;
      } catch {
        return `Must be a valid integer for ${type}.`;
      }
    }

    case 'Vec':
    case 'Map':
      try {
        JSON.parse(trimmed);
        return null;
      } catch {
        return `Must be valid JSON for ${type}.`;
      }

    default:
      // Unknown / extension types: just require non-empty
      return null;
  }
}

// ─── XDR encoding helpers ──────────────────────────────────────────────────────

/**
 * Encode a string value into the appropriate ScVal for the given Soroban type.
 */
export function encodeTypedValue(type: SorobanParamType, value: string): xdr.ScVal {
  const trimmed = value.trim();

  switch (type) {
    case 'Address':
      return xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(
            Buffer.from(
              // Decode the raw 32-byte payload from the Stellar strkey
              Buffer.from(trimmed).slice(1, 33),
            ),
          ),
        ),
      );

    case 'Symbol':
      return xdr.ScVal.scvSymbol(trimmed);

    case 'String':
      return xdr.ScVal.scvString(trimmed);

    case 'Bytes':
      return xdr.ScVal.scvBytes(Buffer.from(trimmed));

    case 'Bool':
      return xdr.ScVal.scvBool(trimmed === 'true');

    case 'i32':
      return xdr.ScVal.scvI32(Number(trimmed));

    case 'u32':
      return xdr.ScVal.scvU32(Number(trimmed));

    case 'i64':
      return xdr.ScVal.scvI64(BigInt(trimmed));

    case 'u64': {
      const lo = BigInt(trimmed) & 0xffff_ffffn;
      const hi = BigInt(trimmed) >> 32n;
      return xdr.ScVal.scvU64(
        new xdr.Uint64({ lo: Number(lo), hi: Number(hi) }),
      );
    }

    case 'i128': {
      const n = BigInt(trimmed);
      const lo = n & 0xffff_ffff_ffff_ffffn;
      const hi = n >> 64n;
      return xdr.ScVal.scvI128(
        new xdr.Int128Parts({ lo: BigInt(lo), hi: BigInt(hi) }),
      );
    }

    case 'u128': {
      const n = BigInt(trimmed);
      const lo = n & 0xffff_ffff_ffff_ffffn;
      const hi = n >> 64n;
      return xdr.ScVal.scvU128(
        new xdr.UInt128Parts({ lo: BigInt(lo), hi: BigInt(hi) }),
      );
    }

    case 'Vec': {
      const arr = JSON.parse(trimmed) as unknown[];
      return xdr.ScVal.scvVec(arr.map((item) => encodeRawValue(item)));
    }

    case 'Map': {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      return xdr.ScVal.scvMap(
        Object.entries(obj).map(
          ([k, v]) =>
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol(k),
              val: encodeRawValue(v),
            }),
        ),
      );
    }

    default:
      // Fall back to string encoding for unknown types
      return xdr.ScVal.scvString(trimmed);
  }
}

/** Recursively encode an arbitrary JS value into ScVal (used for Vec/Map members). */
function encodeRawValue(value: unknown): xdr.ScVal {
  if (typeof value === 'string') return xdr.ScVal.scvString(value);
  if (typeof value === 'number') return xdr.ScVal.scvI64(BigInt(Math.trunc(value)));
  if (typeof value === 'boolean') return xdr.ScVal.scvBool(value);
  if (Array.isArray(value)) return xdr.ScVal.scvVec(value.map(encodeRawValue));
  if (value !== null && typeof value === 'object') {
    return xdr.ScVal.scvMap(
      Object.entries(value as Record<string, unknown>).map(
        ([k, v]) =>
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol(k),
            val: encodeRawValue(v),
          }),
      ),
    );
  }
  return xdr.ScVal.scvVoid();
}

/** Parse a raw-JSON arguments textarea string into a list of ScVals (legacy fallback). */
const parseRawArguments = (raw: string): xdr.ScVal[] => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => encodeRawValue(item));
  } catch {
    return [];
  }
};

/** Parse a contract spec JSON string. Returns null on failure. */
export function parseContractSpec(raw: string): ContractSpec | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'functions' in parsed &&
      Array.isArray((parsed as ContractSpec).functions)
    ) {
      return parsed as ContractSpec;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface ParamInputProps {
  param: ContractFunctionParam;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

/** Single dynamic parameter input row. */
const ParamInput: React.FC<ParamInputProps> = ({ param, value, onChange, error }) => {
  const isMultiline = param.type === 'Vec' || param.type === 'Map';
  const isBool = param.type === 'Bool';

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
        {param.name}
        <span className="rounded bg-slate-700/60 px-1.5 py-0.5 font-mono text-xs text-slate-400">
          {param.type}
        </span>
      </label>

      {isBool ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field w-full"
          aria-label={`${param.name} (${param.type})`}
          aria-invalid={!!error}
        >
          <option value="">-- select --</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : isMultiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="input-field min-h-20 w-full font-mono text-sm"
          placeholder={param.type === 'Vec' ? '["item1", "item2"]' : '{"key": "value"}'}
          aria-label={`${param.name} (${param.type})`}
          aria-invalid={!!error}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field w-full"
          placeholder={placeholderFor(param.type)}
          aria-label={`${param.name} (${param.type})`}
          aria-invalid={!!error}
        />
      )}

      {error && (
        <p role="alert" className="text-xs text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
};

function placeholderFor(type: SorobanParamType): string {
  switch (type) {
    case 'Address': return 'GABC… or CABC… (56 chars)';
    case 'Symbol': return 'my_symbol';
    case 'i128':
    case 'u128': return '1000000000000';
    case 'i64':
    case 'u64': return '100000';
    case 'i32':
    case 'u32': return '42';
    case 'Bool': return 'true / false';
    case 'Bytes': return 'hex or utf-8 bytes';
    default: return '';
  }
}

// ─── Main component ────────────────────────────────────────────────────────────

export interface ContractPlaygroundProps {
  apiBaseUrl?: string;
  /** Optional initial spec JSON string for testing/storybook */
  initialSpecJson?: string;
}

export const ContractPlayground: React.FC<ContractPlaygroundProps> = ({
  apiBaseUrl = 'http://localhost:3002',
  initialSpecJson,
}) => {
  // -- Contract identity
  const [contractId, setContractId] = useState('CB64D3...');

  // -- Spec
  const [specJson, setSpecJson] = useState<string>(initialSpecJson ?? '');
  const [specError, setSpecError] = useState<string>('');
  const parsedSpec = useMemo<ContractSpec | null>(() => {
    if (!specJson.trim()) return null;
    const s = parseContractSpec(specJson);
    return s;
  }, [specJson]);

  // -- Function selection
  const [selectedFnName, setSelectedFnName] = useState<string>('');
  const selectedFn = useMemo<ContractFunctionSpec | undefined>(
    () => parsedSpec?.functions.find((f) => f.name === selectedFnName),
    [parsedSpec, selectedFnName],
  );

  // Auto-select first function when spec is loaded (including initial prop)
  useEffect(() => {
    if (parsedSpec && !selectedFnName) {
      const first = parsedSpec.functions[0];
      if (first) setSelectedFnName(first.name);
    }
    if (!parsedSpec) {
      setSelectedFnName('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedSpec]);

  // When spec changes, auto-select first function
  const handleSpecChange = (value: string) => {
    setSpecJson(value);
    setSpecError('');
    setResult('');
    setXdrPreview('');
    setParamValues({});
    setParamErrors({});
    if (!value.trim()) return;
    const s = parseContractSpec(value);
    if (!s) {
      setSpecError('Invalid contract spec JSON. Expected { "functions": [...] }.');
      return;
    }
    const first = s.functions[0];
    if (first) setSelectedFnName(first.name);
    else setSelectedFnName('');
  };

  // -- Parameter values & errors
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [paramErrors, setParamErrors] = useState<Record<string, string>>({});

  const setParam = (name: string, value: string) => {
    setParamValues((prev) => ({ ...prev, [name]: value }));
    // Clear error on change
    setParamErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  // -- Legacy raw-JSON fallback (when no spec is provided)
  const [legacyFnName, setLegacyFnName] = useState('get_name');
  const [legacyArgs, setLegacyArgs] = useState('{"name":"AnchorPoint"}');

  // -- Results
  const [result, setResult] = useState<string>('');
  const [xdrPreview, setXdrPreview] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  // -- XDR panel visibility
  const [xdrOpen, setXdrOpen] = useState(false);

  // ── Validation ────────────────────────────────────────────────────────────
  const validateAllParams = (): boolean => {
    if (!selectedFn) return true;
    const errors: Record<string, string> = {};
    for (const param of selectedFn.params) {
      const val = (paramValues[param.name] ?? '').trim();
      const err = validateSorobanParam(param.type, val === '' ? '' : val);
      if (err) errors[param.name] = err;
    }
    setParamErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Build ScVal list ─────────────────────────────────────────────────────
  const buildScVals = (): xdr.ScVal[] => {
    if (!selectedFn) {
      // Legacy path
      return parseRawArguments(legacyArgs);
    }
    return selectedFn.params.map((p) =>
      encodeTypedValue(p.type, paramValues[p.name] ?? ''),
    );
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateAllParams()) return;

    setIsLoading(true);
    setError('');
    setResult('');
    setXdrPreview('');

    const fnName = selectedFn ? selectedFn.name : legacyFnName;

    try {
      const response = await fetch(`${apiBaseUrl}/api/config`);
      if (!response.ok) throw new Error('Unable to reach backend config endpoint');

      const rpcUrl = 'https://soroban-testnet.stellar.org';
      const {
        rpc: { Server },
        TransactionBuilder,
        Account,
      } = await import('@stellar/stellar-sdk');

      const server = new Server(rpcUrl);
      const contract = new Contract(contractId);
      const scVals = buildScVals();

      const tx = new TransactionBuilder(
        new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'),
        {
          fee: '100',
          networkPassphrase: 'Test SDF Network ; September 2015',
        },
      )
        .addOperation(contract.call(fnName, ...scVals))
        .setTimeout(30)
        .build();

      // Expose XDR before simulating
      setXdrPreview(tx.toXDR());

      const simulated = await server.simulateTransaction(tx);
      const retval = simulated?.result?.retval;
      if (!retval) throw new Error('The contract returned no value.');

      setResult(JSON.stringify(scValToNative(retval), null, 2));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to simulate contract call';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const hasSpec = parsedSpec !== null;

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Sparkles size={16} className="text-primary-text" />
          Soroban contract playground
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Paste a contract spec JSON to generate a typed parameter form, or use the raw JSON
          arguments fallback for quick simulations.
        </p>
      </div>

      {/* Main form */}
      <form onSubmit={handleSubmit} className="glass-card space-y-6 p-6">
        {/* Contract ID */}
        <label className="block space-y-2 text-sm text-slate-300">
          <span className="font-medium">Contract ID</span>
          <input
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            className="input-field w-full"
            placeholder="CD… or CB…"
            aria-label="Contract ID"
          />
        </label>

        {/* Contract Spec JSON */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-300">
            Contract spec JSON{' '}
            <span className="font-normal text-slate-500">(optional – enables typed inputs)</span>
          </label>
          <textarea
            value={specJson}
            onChange={(e) => handleSpecChange(e.target.value)}
            rows={5}
            className="input-field min-h-28 w-full font-mono text-xs"
            placeholder={`{\n  "functions": [\n    { "name": "transfer", "params": [{"name": "to", "type": "Address"}, {"name": "amount", "type": "i128"}] }\n  ]\n}`}
            aria-label="Contract spec JSON"
          />
          {specError && (
            <p role="alert" className="text-xs text-rose-400">
              {specError}
            </p>
          )}
        </div>

        {/* Dynamic form – spec mode */}
        {hasSpec && (
          <>
            {/* Function selector */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300">Function</label>
              <select
                value={selectedFnName}
                onChange={(e) => {
                  setSelectedFnName(e.target.value);
                  setParamValues({});
                  setParamErrors({});
                  setResult('');
                  setXdrPreview('');
                }}
                className="input-field w-full"
                aria-label="Select function"
              >
                {parsedSpec.functions.map((fn) => (
                  <option key={fn.name} value={fn.name}>
                    {fn.name}
                    {fn.returnType ? ` → ${fn.returnType}` : ''}
                  </option>
                ))}
              </select>

              {selectedFn?.doc && (
                <p className="text-xs text-slate-400">{selectedFn.doc}</p>
              )}
            </div>

            {/* Dynamic parameter fields */}
            {selectedFn && selectedFn.params.length > 0 && (
              <div className="space-y-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Parameters
                </p>
                {selectedFn.params.map((param) => (
                  <ParamInput
                    key={param.name}
                    param={param}
                    value={paramValues[param.name] ?? ''}
                    onChange={(v) => setParam(param.name, v)}
                    error={paramErrors[param.name]}
                  />
                ))}
              </div>
            )}

            {selectedFn && selectedFn.params.length === 0 && (
              <p className="text-xs text-slate-500">
                This function takes no parameters.
              </p>
            )}
          </>
        )}

        {/* Legacy mode – no spec provided */}
        {!hasSpec && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-300">
              <span className="font-medium">Function name</span>
              <input
                value={legacyFnName}
                onChange={(e) => setLegacyFnName(e.target.value)}
                className="input-field w-full"
                placeholder="get_name"
                aria-label="Function name"
              />
            </label>

            <label className="block space-y-2 text-sm text-slate-300 md:col-span-2">
              <span className="font-medium">Arguments (JSON array)</span>
              <textarea
                value={legacyArgs}
                onChange={(e) => setLegacyArgs(e.target.value)}
                rows={4}
                className="input-field min-h-28 w-full font-mono text-sm"
                placeholder='["AnchorPoint"]'
                aria-label="Arguments JSON array"
              />
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Play size={16} />
          {isLoading ? 'Simulating…' : 'Simulate call'}
        </button>
      </form>

      {/* XDR payload preview */}
      {xdrPreview && (
        <div className="glass-card p-6">
          <button
            type="button"
            onClick={() => setXdrOpen((o) => !o)}
            className="flex w-full items-center gap-2 text-sm font-semibold text-slate-200"
            aria-expanded={xdrOpen}
            aria-controls="xdr-preview-panel"
          >
            {xdrOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <Code2 size={16} className="text-primary-text" />
            XDR payload preview
          </button>

          {xdrOpen && (
            <pre
              id="xdr-preview-panel"
              className="mt-3 overflow-x-auto rounded-lg bg-slate-950/80 p-4 font-mono text-xs text-slate-400 break-all whitespace-pre-wrap"
              aria-label="XDR payload"
            >
              {xdrPreview}
            </pre>
          )}
        </div>
      )}

      {/* Result panel */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <TerminalSquare size={16} className="text-primary-text" />
          Result
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300"
          >
            {error}
          </p>
        ) : result ? (
          <pre
            className="mt-3 overflow-x-auto rounded-lg bg-slate-950/80 p-4 text-sm text-slate-200"
            aria-label="Simulation result"
          >
            {result}
          </pre>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            Run a simulation to inspect the decoded return value.
          </p>
        )}
      </div>
    </div>
  );
};

export default ContractPlayground;
