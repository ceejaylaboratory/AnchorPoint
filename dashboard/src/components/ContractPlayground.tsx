import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown, Code2, Play, Sparkles, TerminalSquare } from 'lucide-react';
import { Contract, scValToNative, xdr } from '@stellar/stellar-sdk';

// ---------------------------------------------------------------------------
// Soroban contract spec types
// ---------------------------------------------------------------------------

export type SorobanParamType =
  | 'Address'
  | 'Symbol'
  | 'String'
  | 'i128'
  | 'i64'
  | 'u128'
  | 'u64'
  | 'u32'
  | 'i32'
  | 'Bool'
  | 'Bytes'
  | 'Vec'
  | 'Map'
  | string;

export interface SorobanParam {
  name: string;
  type: SorobanParamType;
  optional?: boolean;
  description?: string;
}

export interface SorobanFunctionSpec {
  name: string;
  doc?: string;
  inputs: SorobanParam[];
  outputs?: SorobanParamType[];
}

export interface SorobanContractSpec {
  functions: SorobanFunctionSpec[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Returns an error string if invalid, or null if valid. */
export const validateParam = (value: string, type: SorobanParamType): string | null => {
  const trimmed = value.trim();

  if (trimmed === '') {
    return 'Value is required';
  }

  switch (type) {
    case 'Address': {
      // Stellar public keys are 56 chars starting with G, contract IDs start with C
      if (!/^[GC][A-Z2-7]{55}$/.test(trimmed)) {
        return 'Invalid Stellar address (must start with G or C, 56 chars)';
      }
      return null;
    }
    case 'Symbol': {
      // Soroban Symbols: up to 32 chars, alphanumeric + underscore
      if (!/^[a-zA-Z0-9_]{1,32}$/.test(trimmed)) {
        return 'Symbol must be 1–32 alphanumeric/underscore characters';
      }
      return null;
    }
    case 'String': {
      return null; // any string is valid
    }
    case 'i128':
    case 'i64':
    case 'i32': {
      if (!/^-?\d+$/.test(trimmed)) {
        return `${type} must be a signed integer`;
      }
      return null;
    }
    case 'u128':
    case 'u64':
    case 'u32': {
      if (!/^\d+$/.test(trimmed)) {
        return `${type} must be an unsigned integer (non-negative)`;
      }
      return null;
    }
    case 'Bool': {
      if (trimmed !== 'true' && trimmed !== 'false') {
        return 'Bool must be "true" or "false"';
      }
      return null;
    }
    case 'Bytes': {
      // Expect hex string
      if (!/^([0-9a-fA-F]{2})*$/.test(trimmed)) {
        return 'Bytes must be a hex string (even number of hex chars)';
      }
      return null;
    }
    case 'Vec':
    case 'Map': {
      try {
        JSON.parse(trimmed);
        return null;
      } catch {
        return `${type} must be valid JSON`;
      }
    }
    default: {
      return null;
    }
  }
};

// ---------------------------------------------------------------------------
// XDR encoding helpers
// ---------------------------------------------------------------------------

/** Convert a validated string value + Soroban type into an xdr.ScVal. */
export const encodeParamToScVal = (value: string, type: SorobanParamType): xdr.ScVal => {
  const trimmed = value.trim();

  switch (type) {
    case 'Address':
      return xdr.ScVal.scvAddress(
        xdr.ScAddress.scAddressTypeAccount(
          xdr.PublicKey.publicKeyTypeEd25519(
            Buffer.from(
              // decode strkey – we can use stellar-sdk StrKey
              (() => {
                const { StrKey } = require('@stellar/stellar-sdk');
                if (trimmed.startsWith('G')) {
                  return StrKey.decodeEd25519PublicKey(trimmed);
                }
                // Contract address
                return StrKey.decodeContract(trimmed);
              })(),
            ),
          ),
        ),
      );
    case 'Symbol':
      return xdr.ScVal.scvSymbol(trimmed);
    case 'String':
      return xdr.ScVal.scvString(trimmed);
    case 'i128': {
      const n = BigInt(trimmed);
      return xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: xdr.Int64.fromString((n >> 64n).toString()), lo: xdr.Uint64.fromString((n & 0xffffffffffffffffn).toString()) }));
    }
    case 'i64':
      return xdr.ScVal.scvI64(xdr.Int64.fromString(trimmed));
    case 'i32':
      return xdr.ScVal.scvI32(parseInt(trimmed, 10));
    case 'u128': {
      const n = BigInt(trimmed);
      return xdr.ScVal.scvU128(new xdr.UInt128Parts({ hi: xdr.Uint64.fromString((n >> 64n).toString()), lo: xdr.Uint64.fromString((n & 0xffffffffffffffffn).toString()) }));
    }
    case 'u64':
      return xdr.ScVal.scvU64(xdr.Uint64.fromString(trimmed));
    case 'u32':
      return xdr.ScVal.scvU32(parseInt(trimmed, 10));
    case 'Bool':
      return xdr.ScVal.scvBool(trimmed === 'true');
    case 'Bytes': {
      const bytes = Buffer.from(trimmed, 'hex');
      return xdr.ScVal.scvBytes(bytes);
    }
    case 'Vec': {
      const items: unknown[] = JSON.parse(trimmed);
      return xdr.ScVal.scvVec(items.map((item) => encodeGenericValue(item)));
    }
    case 'Map': {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      return xdr.ScVal.scvMap(
        Object.entries(obj).map(
          ([k, v]) =>
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol(k),
              val: encodeGenericValue(v),
            }),
        ),
      );
    }
    default:
      return xdr.ScVal.scvString(trimmed);
  }
};

/** Fallback generic encoder for nested Vec/Map values. */
const encodeGenericValue = (value: unknown): xdr.ScVal => {
  if (typeof value === 'string') return xdr.ScVal.scvString(value);
  if (typeof value === 'number') return xdr.ScVal.scvI64(xdr.Int64.fromString(String(Math.trunc(value))));
  if (typeof value === 'boolean') return xdr.ScVal.scvBool(value);
  if (Array.isArray(value)) return xdr.ScVal.scvVec(value.map(encodeGenericValue));
  if (value && typeof value === 'object') {
    return xdr.ScVal.scvMap(
      Object.entries(value as Record<string, unknown>).map(
        ([k, v]) =>
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol(k),
            val: encodeGenericValue(v),
          }),
      ),
    );
  }
  return xdr.ScVal.scvVoid();
};

// ---------------------------------------------------------------------------
// Contract spec parser
// ---------------------------------------------------------------------------

/**
 * Parse a raw JSON string into a SorobanContractSpec.
 * Accepts both the full `{ functions: [...] }` shape and a bare array of functions.
 */
export const parseContractSpec = (raw: string): { spec: SorobanContractSpec | null; error: string | null } => {
  if (!raw.trim()) {
    return { spec: null, error: null };
  }
  try {
    const parsed: unknown = JSON.parse(raw);

    // Bare array of function specs
    if (Array.isArray(parsed)) {
      const functions = parsed as SorobanFunctionSpec[];
      return { spec: { functions }, error: null };
    }

    // Object with a `functions` key
    if (parsed && typeof parsed === 'object' && 'functions' in parsed) {
      return { spec: parsed as SorobanContractSpec, error: null };
    }

    return { spec: null, error: 'Spec must be a JSON object with a "functions" array, or a bare array of function specs.' };
  } catch {
    return { spec: null, error: 'Invalid JSON – please check your contract spec.' };
  }
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ParamFieldProps {
  param: SorobanParam;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}

const ParamField: React.FC<ParamFieldProps> = ({ param, value, onChange, error }) => {
  const isBool = param.type === 'Bool';
  const isMultiLine = param.type === 'Vec' || param.type === 'Map';

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-xs font-medium text-slate-300">
        <span>{param.name}</span>
        <span className="rounded bg-slate-700/60 px-1.5 py-0.5 font-mono text-[10px] text-primary-text">
          {param.type}
        </span>
        {param.optional && (
          <span className="text-slate-500 text-[10px]">(optional)</span>
        )}
      </label>
      {param.description && (
        <p className="text-[11px] text-slate-500">{param.description}</p>
      )}

      {isBool ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field w-full text-sm"
          aria-label={`${param.name} (${param.type})`}
        >
          <option value="">Select…</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : isMultiLine ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="input-field w-full font-mono text-xs"
          placeholder={param.type === 'Vec' ? '["item1", "item2"]' : '{"key": "value"}'}
          aria-label={`${param.name} (${param.type})`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field w-full text-sm"
          placeholder={placeholderForType(param.type)}
          aria-label={`${param.name} (${param.type})`}
        />
      )}

      {error && (
        <p className="text-[11px] text-rose-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

const placeholderForType = (type: SorobanParamType): string => {
  switch (type) {
    case 'Address': return 'GABC... or CABC...';
    case 'Symbol': return 'my_symbol';
    case 'String': return 'Hello, world!';
    case 'i128': case 'i64': case 'i32': return '-1000000';
    case 'u128': case 'u64': case 'u32': return '1000000';
    case 'Bytes': return 'deadbeef';
    default: return '';
  }
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface ContractPlaygroundProps {
  apiBaseUrl?: string;
}

const DEFAULT_SPEC_PLACEHOLDER = `{
  "functions": [
    {
      "name": "get_name",
      "doc": "Returns the contract name",
      "inputs": [],
      "outputs": ["Symbol"]
    },
    {
      "name": "transfer",
      "doc": "Transfer tokens",
      "inputs": [
        { "name": "from", "type": "Address" },
        { "name": "to", "type": "Address" },
        { "name": "amount", "type": "i128" }
      ]
    }
  ]
}`;

export const ContractPlayground: React.FC<ContractPlaygroundProps> = ({ apiBaseUrl = 'http://localhost:3002' }) => {
  // Contract configuration
  const [contractId, setContractId] = useState('CB64D3...');
  const [specRaw, setSpecRaw] = useState('');
  const [specPanelOpen, setSpecPanelOpen] = useState(true);

  // Parsed spec
  const { spec, error: specError } = useMemo(() => parseContractSpec(specRaw), [specRaw]);

  // Selected function
  const [selectedFnName, setSelectedFnName] = useState('');
  const selectedFn = useMemo(
    () => spec?.functions.find((f) => f.name === selectedFnName) ?? null,
    [spec, selectedFnName],
  );

  // Per-parameter values and validation errors
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [paramErrors, setParamErrors] = useState<Record<string, string | null>>({});

  // Reset param state when function selection changes
  const handleFnChange = useCallback((fnName: string) => {
    setSelectedFnName(fnName);
    setParamValues({});
    setParamErrors({});
    setResult('');
    setError('');
    setXdrPreview('');
  }, []);

  const handleParamChange = useCallback((name: string, value: string, type: SorobanParamType) => {
    setParamValues((prev) => ({ ...prev, [name]: value }));
    setParamErrors((prev) => ({ ...prev, [name]: validateParam(value, type) }));
  }, []);

  // Execution state
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [xdrPreview, setXdrPreview] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Validate all params; returns true if all pass
  const validateAll = useCallback((): boolean => {
    if (!selectedFn) return false;
    const errors: Record<string, string | null> = {};
    let valid = true;
    for (const param of selectedFn.inputs) {
      const value = paramValues[param.name] ?? '';
      const err = validateParam(value, param.type);
      errors[param.name] = err;
      if (err) valid = false;
    }
    setParamErrors(errors);
    return valid;
  }, [selectedFn, paramValues]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFn) return;
    if (!validateAll()) return;

    setIsLoading(true);
    setError('');
    setResult('');
    setXdrPreview('');

    try {
      // Build scVal arguments from validated param values
      const scVals = selectedFn.inputs.map((param) =>
        encodeParamToScVal(paramValues[param.name] ?? '', param.type),
      );

      // Build the transaction for simulation
      const rpcUrl = 'https://soroban-testnet.stellar.org';
      const sdkModule = await import('@stellar/stellar-sdk');
      const server = new sdkModule.rpc.Server(rpcUrl);
      const contract = new Contract(contractId);
      const tx = new sdkModule.TransactionBuilder(
        new sdkModule.Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'),
        {
          fee: '100',
          networkPassphrase: 'Test SDF Network ; September 2015',
        },
      )
        .addOperation(contract.call(selectedFnName, ...scVals))
        .setTimeout(30)
        .build();

      // XDR preview of the transaction envelope
      const xdrEnvelope = tx.toXDR();
      setXdrPreview(xdrEnvelope);

      const simulated = await server.simulateTransaction(tx);
      const retval = simulated?.result?.retval;
      if (!retval) {
        throw new Error('The contract returned no value.');
      }
      setResult(JSON.stringify(scValToNative(retval), null, 2));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to simulate contract call';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Sparkles size={16} className="text-primary-text" />
          Soroban contract playground
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Paste a contract spec JSON to auto-generate a typed call form, validate parameters, and inspect the decoded
          return value and XDR payload.
        </p>
      </div>

      {/* Contract configuration */}
      <div className="glass-card space-y-4 p-6">
        <label className="block space-y-2 text-sm text-slate-300">
          <span className="font-medium">Contract ID</span>
          <input
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            className="input-field w-full"
            placeholder="CD..."
            aria-label="Contract ID"
          />
        </label>

        {/* Spec input */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setSpecPanelOpen((o) => !o)}
            className="flex w-full items-center justify-between text-sm font-medium text-slate-300"
          >
            <span>Contract spec JSON</span>
            <ChevronDown
              size={16}
              className={`transition-transform ${specPanelOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {specPanelOpen && (
            <div className="space-y-2">
              <textarea
                value={specRaw}
                onChange={(e) => {
                  setSpecRaw(e.target.value);
                  setSelectedFnName('');
                  setParamValues({});
                  setParamErrors({});
                }}
                rows={8}
                className="input-field w-full font-mono text-xs"
                placeholder={DEFAULT_SPEC_PLACEHOLDER}
                aria-label="Contract spec JSON"
              />
              {specError && (
                <p className="text-xs text-rose-400" role="alert">
                  {specError}
                </p>
              )}
              {spec && (
                <p className="text-xs text-emerald-400">
                  ✓ Loaded {spec.functions.length} function{spec.functions.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dynamic call form */}
      {spec && spec.functions.length > 0 && (
        <form onSubmit={handleSubmit} className="glass-card space-y-6 p-6">
          {/* Function selector */}
          <div className="space-y-2 text-sm text-slate-300">
            <label htmlFor="fn-select" className="font-medium">
              Function
            </label>
            <select
              id="fn-select"
              value={selectedFnName}
              onChange={(e) => handleFnChange(e.target.value)}
              className="input-field w-full"
            >
              <option value="">Select a function…</option>
              {spec.functions.map((fn) => (
                <option key={fn.name} value={fn.name}>
                  {fn.name}
                  {fn.inputs.length > 0 ? ` (${fn.inputs.map((p) => p.name).join(', ')})` : ' ()'}
                </option>
              ))}
            </select>
            {selectedFn?.doc && (
              <p className="text-xs text-slate-400 italic">{selectedFn.doc}</p>
            )}
          </div>

          {/* Dynamic parameter fields */}
          {selectedFn && (
            <>
              {selectedFn.inputs.length === 0 ? (
                <p className="text-xs text-slate-500">This function takes no arguments.</p>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Parameters</p>
                  {selectedFn.inputs.map((param) => (
                    <ParamField
                      key={param.name}
                      param={param}
                      value={paramValues[param.name] ?? ''}
                      onChange={(v) => handleParamChange(param.name, v, param.type)}
                      error={paramErrors[param.name] ?? null}
                    />
                  ))}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !selectedFnName}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play size={16} />
                {isLoading ? 'Simulating…' : 'Simulate call'}
              </button>
            </>
          )}
        </form>
      )}

      {/* Result panel */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <TerminalSquare size={16} className="text-primary-text" />
          Result
        </div>
        {error ? (
          <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300" role="alert">
            {error}
          </p>
        ) : result ? (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950/80 p-4 text-sm text-slate-200">{result}</pre>
        ) : (
          <p className="mt-3 text-sm text-slate-400">Run a simulation to inspect the decoded return value.</p>
        )}
      </div>

      {/* XDR preview panel */}
      {xdrPreview && (
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Code2 size={16} className="text-primary-text" />
            XDR payload preview
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Base64-encoded transaction envelope sent to the RPC simulation endpoint.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950/80 p-4 text-xs text-slate-300 break-all whitespace-pre-wrap">
            {xdrPreview}
          </pre>
        </div>
      )}
    </div>
  );
};

export default ContractPlayground;
