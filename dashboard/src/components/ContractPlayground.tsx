import React, { useState, useMemo } from 'react';
import { 
  Play, 
  Terminal, 
  Wallet, 
  Code, 
  CheckCircle2, 
  AlertCircle, 
  Copy, 
  Check, 
  Cpu, 
  Layers, 
  ExternalLink,
  ChevronRight,
  FileCode2,
  Sparkles
} from 'lucide-react';

export type SorobanType = 'Address' | 'i128' | 'Symbol' | 'Bytes' | 'u32' | 'u64' | 'bool' | 'String';

export interface MethodParam {
  name: string;
  type: SorobanType;
  doc?: string;
  defaultValue?: string;
}

export interface ContractMethod {
  name: string;
  doc?: string;
  inputs: MethodParam[];
  returnType: SorobanType | '()';
}

export interface ContractSpec {
  id: string;
  name: string;
  contractAddress: string;
  methods: ContractMethod[];
}

export interface ExecutionEvent {
  topic: string[];
  data: Record<string, any>;
  timestamp: string;
}

export interface ExecutionResult {
  status: 'SUCCESS' | 'FAILED';
  method: string;
  contractId: string;
  txHash: string;
  returnValue: any;
  cpuInstructions: number;
  memoryBytes: number;
  events: ExecutionEvent[];
  rawXdr?: string;
}

// Built-in presets for contracts
export const PRESET_CONTRACTS: ContractSpec[] = [
  {
    id: 'sep41-token',
    name: 'SEP-41 Token Contract',
    contractAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    methods: [
      {
        name: 'balance',
        doc: 'Queries the token balance of the specified account address.',
        inputs: [
          { name: 'id', type: 'Address', doc: 'Account public key (G...) or Contract ID (C...)' }
        ],
        returnType: 'i128'
      },
      {
        name: 'transfer',
        doc: 'Transfers token amount from sender address to recipient address.',
        inputs: [
          { name: 'from', type: 'Address', doc: 'Sender address' },
          { name: 'to', type: 'Address', doc: 'Recipient address' },
          { name: 'amount', type: 'i128', doc: 'Amount in stroops (1 token = 10,000,000)' }
        ],
        returnType: '()'
      },
      {
        name: 'mint',
        doc: 'Mints new tokens to target address (admin only).',
        inputs: [
          { name: 'to', type: 'Address', doc: 'Target recipient address' },
          { name: 'amount', type: 'i128', doc: 'Amount to mint' }
        ],
        returnType: '()'
      },
      {
        name: 'approve',
        doc: 'Approves a spender to transfer tokens up to an amount.',
        inputs: [
          { name: 'from', type: 'Address', doc: 'Owner address' },
          { name: 'spender', type: 'Address', doc: 'Spender address' },
          { name: 'amount', type: 'i128', doc: 'Allowed amount' },
          { name: 'expiration_ledger', type: 'u32', doc: 'Ledger sequence when approval expires' }
        ],
        returnType: '()'
      }
    ]
  },
  {
    id: 'liquidation-vault',
    name: 'Liquidation Vault Pool',
    contractAddress: 'CA7XN94KLWP28VMCQ90184HNXC720M94LQPWRTU791BVCS82410948VC',
    methods: [
      {
        name: 'liquidate',
        doc: 'Seizes collateral of an under-collateralized vault and pays debt.',
        inputs: [
          { name: 'liquidator', type: 'Address', doc: 'Liquidator wallet address' },
          { name: 'vault_id', type: 'Symbol', doc: 'Vault identifier (e.g. VAULT_1092)' },
          { name: 'debt_to_cover', type: 'i128', doc: 'Debt amount to cover' }
        ],
        returnType: 'i128'
      },
      {
        name: 'get_health_factor',
        doc: 'Calculates the real-time health factor of a vault.',
        inputs: [
          { name: 'vault_id', type: 'Symbol', doc: 'Unique vault symbol ID' }
        ],
        returnType: 'i128'
      },
      {
        name: 'update_oracle_price',
        doc: 'Admin method to update asset feed price.',
        inputs: [
          { name: 'asset', type: 'Symbol', doc: 'Asset symbol (e.g. XLM or USDC)' },
          { name: 'price_stroop', type: 'i128', doc: 'Price scaled by 10^7' },
          { name: 'signature_bytes', type: 'Bytes', doc: 'Oracle signature payload (hex)' }
        ],
        returnType: '()'
      }
    ]
  },
  {
    id: 'sep38-quotes',
    name: 'SEP-38 Price Quote Router',
    contractAddress: 'CB987MCZX9418VNVMAOS81481098234LALQ894182903148109384102',
    methods: [
      {
        name: 'get_quote',
        doc: 'Fetches indicative price conversion quote between assets.',
        inputs: [
          { name: 'sell_asset', type: 'Symbol', doc: 'Source asset symbol' },
          { name: 'buy_asset', type: 'Symbol', doc: 'Destination asset symbol' },
          { name: 'sell_amount', type: 'i128', doc: 'Amount to convert' }
        ],
        returnType: 'i128'
      },
      {
        name: 'execute_swap',
        doc: 'Fulfills a pre-approved quote with proof bytes.',
        inputs: [
          { name: 'user', type: 'Address', doc: 'User account address' },
          { name: 'quote_id', type: 'Bytes', doc: '32-byte quote hash' },
          { name: 'min_buy_amount', type: 'i128', doc: 'Slippage limit' }
        ],
        returnType: '()'
      }
    ]
  }
];

export function validateArg(type: SorobanType, value: string): { isValid: boolean; error?: string } {
  if (value === undefined || value === null || value.trim() === '') {
    return { isValid: false, error: 'Value is required' };
  }

  const trimmed = value.trim();

  switch (type) {
    case 'Address': {
      // Stellar Address starts with G or C and is 56 chars long alphanumeric
      const isStellarAddr = /^[GC][A-Z0-9]{55}$/.test(trimmed);
      if (!isStellarAddr) {
        return { isValid: false, error: 'Must be a valid 56-character Stellar Address (G... or C...)' };
      }
      return { isValid: true };
    }
    case 'i128': {
      // Signed 128-bit integer
      if (!/^-?\d+$/.test(trimmed)) {
        return { isValid: false, error: 'Must be a valid integer' };
      }
      return { isValid: true };
    }
    case 'Symbol': {
      // Soroban symbol: alphanumeric + underscore, max 32 characters
      if (!/^[a-zA-Z0-9_]{1,32}$/.test(trimmed)) {
        return { isValid: false, error: 'Symbol must be 1-32 alphanumeric characters or underscores' };
      }
      return { isValid: true };
    }
    case 'Bytes': {
      // Hex representation or base64
      const isHex = /^(0x)?[0-9a-fA-F]+$/.test(trimmed);
      const isBase64 = /^[A-Za-z0-9+/=]+$/.test(trimmed);
      if (!isHex && !isBase64) {
        return { isValid: false, error: 'Bytes must be valid hex (0x...) or base64 string' };
      }
      return { isValid: true };
    }
    case 'u32':
    case 'u64': {
      if (!/^\d+$/.test(trimmed)) {
        return { isValid: false, error: 'Must be an unsigned positive integer' };
      }
      return { isValid: true };
    }
    case 'bool': {
      if (trimmed !== 'true' && trimmed !== 'false') {
        return { isValid: false, error: 'Must be true or false' };
      }
      return { isValid: true };
    }
    default:
      return { isValid: true };
  }
}

export function parseContractSpec(specJson: string): ContractSpec {
  const parsed = JSON.parse(specJson);
  if (!parsed.contractAddress || !Array.isArray(parsed.methods)) {
    throw new Error('Invalid contract spec: missing contractAddress or methods array');
  }
  return parsed as ContractSpec;
}

interface ContractPlaygroundProps {
  apiBaseUrl?: string;
  initialSpecs?: ContractSpec[];
  defaultWalletAddress?: string;
  onExecuteMethod?: (methodName: string, args: Record<string, any>) => Promise<ExecutionResult> | ExecutionResult;
}

export const ContractPlayground: React.FC<ContractPlaygroundProps> = ({
  apiBaseUrl = 'http://localhost:3002',
  initialSpecs = PRESET_CONTRACTS,
  defaultWalletAddress = 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2ZVOUSW4WQHIFRHZSXO',
  onExecuteMethod
}) => {
  const [specs, setSpecs] = useState<ContractSpec[]>(initialSpecs);
  const [selectedContractId, setSelectedContractId] = useState<string>(specs[0]?.id || '');
  const [selectedMethodName, setSelectedMethodName] = useState<string>(specs[0]?.methods[0]?.name || '');
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(true);
  const [connectedAddress, setConnectedAddress] = useState<string>(defaultWalletAddress);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [activeTab, setActiveTab] = useState<'params' | 'specJson'>('params');
  const [rawSpecInput, setRawSpecInput] = useState<string>('');
  const [copiedTx, setCopiedTx] = useState<boolean>(false);

  const currentContract = useMemo(() => {
    return specs.find(c => c.id === selectedContractId) || specs[0];
  }, [specs, selectedContractId]);

  const currentMethod = useMemo(() => {
    return currentContract?.methods.find(m => m.name === selectedMethodName) || currentContract?.methods[0];
  }, [currentContract, selectedMethodName]);

  // Handle contract change
  const handleContractChange = (contractId: string) => {
    setSelectedContractId(contractId);
    const target = specs.find(c => c.id === contractId) || specs[0];
    if (target?.methods[0]) {
      setSelectedMethodName(target.methods[0].name);
      setFormValues({});
      setFormErrors({});
      setExecutionResult(null);
    }
  };

  // Handle method change
  const handleMethodChange = (methodName: string) => {
    setSelectedMethodName(methodName);
    setFormValues({});
    setFormErrors({});
    setExecutionResult(null);
  };

  const handleInputChange = (paramName: string, paramType: SorobanType, value: string) => {
    setFormValues(prev => ({ ...prev, [paramName]: value }));
    const valResult = validateArg(paramType, value);
    if (!valResult.isValid && valResult.error) {
      setFormErrors(prev => ({ ...prev, [paramName]: valResult.error! }));
    } else {
      setFormErrors(prev => {
        const copy = { ...prev };
        delete copy[paramName];
        return copy;
      });
    }
  };

  const handleFillWalletAddress = (paramName: string) => {
    handleInputChange(paramName, 'Address', connectedAddress);
  };

  const handleExecute = async () => {
    if (!currentMethod) return;

    // Validate all inputs
    const errors: Record<string, string> = {};
    currentMethod.inputs.forEach(param => {
      const val = formValues[param.name] ?? '';
      const valResult = validateArg(param.type, val);
      if (!valResult.isValid) {
        errors[param.name] = valResult.error || 'Invalid value';
      }
    });

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    if (!isWalletConnected) {
      setFormErrors({ _wallet: 'Please connect your Stellar / Soroban wallet first.' });
      return;
    }

    setIsExecuting(true);
    try {
      if (onExecuteMethod) {
        const res = await onExecuteMethod(currentMethod.name, formValues);
        setExecutionResult(res);
      } else {
        // Simulate realistic Soroban invocation delay and output
        await new Promise(resolve => setTimeout(resolve, 800));

        let mockReturn: any = '()';
        if (currentMethod.returnType === 'i128') {
          mockReturn = formValues['amount'] ? `${formValues['amount']}0000000` : '1500000000';
        } else if (currentMethod.returnType === 'Address') {
          mockReturn = connectedAddress;
        }

        const mockResult: ExecutionResult = {
          status: 'SUCCESS',
          method: currentMethod.name,
          contractId: currentContract.contractAddress,
          txHash: `0x${Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
          returnValue: mockReturn,
          cpuInstructions: Math.floor(25000 + Math.random() * 15000),
          memoryBytes: Math.floor(1200 + Math.random() * 600),
          events: [
            {
              topic: [currentContract.name, currentMethod.name],
              data: { ...formValues, invoker: connectedAddress },
              timestamp: new Date().toISOString()
            }
          ],
          rawXdr: 'AAAAAgAAAAAQm9ycm93ZXIAAA=='
        };
        setExecutionResult(mockResult);
      }
    } catch (err: any) {
      setExecutionResult({
        status: 'FAILED',
        method: currentMethod.name,
        contractId: currentContract.contractAddress,
        txHash: '0x00000000000000000000000000000000000000000000000',
        returnValue: { error: err?.message || 'Invocation reverted by contract spec' },
        cpuInstructions: 1250,
        memoryBytes: 300,
        events: []
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleApplyCustomSpec = () => {
    try {
      const parsed = parseContractSpec(rawSpecInput);
      setSpecs(prev => [parsed, ...prev]);
      setSelectedContractId(parsed.id);
      setSelectedMethodName(parsed.methods[0]?.name || '');
      setActiveTab('params');
      setRawSpecInput('');
    } catch (e: any) {
      alert(`Invalid Contract Spec JSON: ${e.message}`);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTx(true);
    setTimeout(() => setCopiedTx(false), 2000);
  };

  return (
    <div className="space-y-6" data-testid="soroban-contract-playground">
      {/* Header bar */}
      <div className="glass-card p-6 border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-primary/20 text-primary rounded-lg">
                <Terminal size={20} />
              </span>
              <h2 className="text-xl font-bold font-display text-slate-100">
                Interactive Soroban Method Caller
              </h2>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Select any Soroban smart contract method to generate dynamic typed input forms and test RPC invocations.
            </p>
          </div>

          {/* Wallet Signer Pill */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs">
              <Wallet size={14} className={isWalletConnected ? 'text-emerald-400' : 'text-slate-500'} />
              <span className="font-mono text-slate-300">
                {isWalletConnected ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}` : 'Wallet Disconnected'}
              </span>
            </div>
            <button
              onClick={() => setIsWalletConnected(!isWalletConnected)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isWalletConnected 
                  ? 'bg-slate-800 text-slate-400 hover:text-rose-400 hover:bg-slate-800/80' 
                  : 'bg-primary text-white hover:bg-primary/90'
              }`}
              data-testid="wallet-connect-toggle"
            >
              {isWalletConnected ? 'Disconnect' : 'Connect Wallet'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Contract & Method Selection and Form */}
        <div className="lg:col-span-7 space-y-6">
          <div className="glass-card p-6 border border-slate-800 space-y-5">
            {/* Contract & Method Pickers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="contract-select" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Target Contract
                </label>
                <select
                  id="contract-select"
                  value={selectedContractId}
                  onChange={e => handleContractChange(e.target.value)}
                  className="input-field w-full text-sm font-medium text-slate-200"
                  data-testid="contract-select"
                >
                  {specs.map(spec => (
                    <option key={spec.id} value={spec.id}>
                      {spec.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="method-select" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Contract Method
                </label>
                <select
                  id="method-select"
                  value={selectedMethodName}
                  onChange={e => handleMethodChange(e.target.value)}
                  className="input-field w-full text-sm font-mono text-primary font-bold"
                  data-testid="method-select"
                >
                  {currentContract?.methods.map(method => (
                    <option key={method.name} value={method.name}>
                      {method.name} ({method.inputs.length} args)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Contract Address Bar */}
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Code size={14} className="text-blue-400" /> Contract ID:
              </span>
              <span className="font-mono text-slate-300 truncate max-w-xs md:max-w-md">
                {currentContract?.contractAddress}
              </span>
            </div>

            {/* Method Documentation */}
            {currentMethod?.doc && (
              <div className="text-xs text-slate-400 bg-slate-900/40 p-3 rounded-lg border border-slate-800/80">
                <span className="font-semibold text-slate-300">Method Description:</span> {currentMethod.doc}
              </div>
            )}

            {/* Tabs: Form Parameters vs Custom Spec JSON */}
            <div className="flex border-b border-slate-800 text-xs font-semibold">
              <button
                onClick={() => setActiveTab('params')}
                className={`pb-2.5 px-3 border-b-2 transition-colors ${
                  activeTab === 'params'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Method Parameters ({currentMethod?.inputs.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('specJson')}
                className={`pb-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 ${
                  activeTab === 'specJson'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileCode2 size={13} /> Custom Spec JSON
              </button>
            </div>

            {/* Tab 1: Dynamic Form Inputs */}
            {activeTab === 'params' && (
              <div className="space-y-4" data-testid="dynamic-form-container">
                {currentMethod?.inputs.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 text-sm italic">
                    This method takes 0 arguments. You can invoke it immediately.
                  </div>
                ) : (
                  currentMethod?.inputs.map(param => {
                    const error = formErrors[param.name];
                    const value = formValues[param.name] ?? '';

                    return (
                      <div key={param.name} className="space-y-1.5" data-testid={`param-group-${param.name}`}>
                        <div className="flex items-center justify-between">
                          <label htmlFor={`param-${param.name}`} className="text-xs font-medium text-slate-300 flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-100">{param.name}</span>
                            <span
                              data-testid={`param-type-${param.name}`}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${
                                param.type === 'Address' ? 'bg-indigo-500/20 text-indigo-300' :
                                param.type === 'i128' ? 'bg-emerald-500/20 text-emerald-300' :
                                param.type === 'Symbol' ? 'bg-amber-500/20 text-amber-300' :
                                param.type === 'Bytes' ? 'bg-purple-500/20 text-purple-300' :
                                'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {param.type}
                            </span>
                          </label>

                          {param.type === 'Address' && isWalletConnected && (
                            <button
                              type="button"
                              onClick={() => handleFillWalletAddress(param.name)}
                              className="text-[11px] text-primary hover:underline font-medium"
                              data-testid={`fill-wallet-${param.name}`}
                            >
                              Paste My Wallet
                            </button>
                          )}
                        </div>

                        {param.doc && (
                          <p className="text-[11px] text-slate-500">{param.doc}</p>
                        )}

                        {/* Typed Form Controls */}
                        {param.type === 'bool' ? (
                          <select
                            id={`param-${param.name}`}
                            value={value}
                            onChange={e => handleInputChange(param.name, param.type, e.target.value)}
                            className="input-field w-full text-sm"
                            data-testid={`param-input-${param.name}`}
                            aria-invalid={error ? 'true' : 'false'}
                            aria-describedby={error ? `param-error-${param.name}` : undefined}
                          >
                            <option value="">Select Boolean...</option>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : (
                          <div className="relative">
                            <input
                              id={`param-${param.name}`}
                              type={param.type === 'u32' || param.type === 'u64' ? 'number' : 'text'}
                              value={value}
                              onChange={e => handleInputChange(param.name, param.type, e.target.value)}
                              placeholder={
                                param.type === 'Address' ? 'G... or C...' :
                                param.type === 'i128' ? 'Amount (e.g. 10000000)' :
                                param.type === 'Symbol' ? 'Symbol name (e.g. USDC)' :
                                param.type === 'Bytes' ? '0x... or base64' :
                                `Enter ${param.type}`
                              }
                              className={`input-field w-full text-sm font-mono ${
                                error ? 'border-rose-500 focus:ring-rose-500/50' : ''
                              }`}
                              data-testid={`param-input-${param.name}`}
                              aria-invalid={error ? 'true' : 'false'}
                              aria-describedby={error ? `param-error-${param.name}` : undefined}
                            />
                            {param.type === 'Bytes' && value && (
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-mono">
                                {value.startsWith('0x') ? `${(value.length - 2) / 2} bytes` : `${value.length} chars`}
                              </span>
                            )}
                          </div>
                        )}

                        {error && (
                          <p id={`param-error-${param.name}`} role="alert" className="text-xs text-rose-400 flex items-center gap-1 mt-1">
                            <AlertCircle size={12} aria-hidden="true" /> {error}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}

                {formErrors['_wallet'] && (
                  <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle size={14} /> {formErrors['_wallet']}
                  </div>
                )}

                {/* Submit Action */}
                <div className="pt-2">
                  <button
                    onClick={handleExecute}
                    disabled={isExecuting}
                    className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm font-bold shadow-lg shadow-blue-500/20 disabled:opacity-50"
                    data-testid="invoke-method-btn"
                  >
                    {isExecuting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Simulating Soroban Transaction...</span>
                      </>
                    ) : (
                      <>
                        <Play size={16} className="fill-current" />
                        <span>Sign & Invoke {currentMethod?.name}()</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Tab 2: Custom Spec JSON Loader */}
            {activeTab === 'specJson' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Paste a Soroban contract spec JSON to dynamically load its methods into the playground.
                </p>
                <textarea
                  rows={8}
                  value={rawSpecInput}
                  onChange={e => setRawSpecInput(e.target.value)}
                  placeholder={`{\n  "id": "my-contract",\n  "name": "My Custom Contract",\n  "contractAddress": "C...",\n  "methods": [\n    {\n      "name": "my_method",\n      "inputs": [{ "name": "user", "type": "Address" }],\n      "returnType": "()"\n    }\n  ]\n}`}
                  className="input-field w-full text-xs font-mono"
                  data-testid="custom-spec-textarea"
                />
                <button
                  type="button"
                  onClick={handleApplyCustomSpec}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors"
                >
                  Load Custom Spec
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Execution Output and Event Logs */}
        <div className="lg:col-span-5 space-y-6">
          {/* Execution Output Panel */}
          <div className="glass-card p-6 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Terminal size={16} className="text-emerald-400" /> Execution Output
              </h3>
              {executionResult && (
                <span
                  data-testid="execution-status-badge"
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                    executionResult.status === 'SUCCESS' 
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {executionResult.status}
                </span>
              )}
            </div>

            {!executionResult ? (
              <div className="py-12 text-center text-slate-500 text-sm">
                <Code size={36} className="mx-auto text-slate-600 mb-3" />
                <p>Run a method invocation to view simulated return values, gas consumption, and event telemetry.</p>
              </div>
            ) : (
              <div className="space-y-4" data-testid="execution-output">
                {/* Transaction telemetry */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
                    <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                      <Cpu size={12} /> CPU Gas
                    </span>
                    <span className="font-mono font-bold text-slate-200 text-sm mt-0.5 block">
                      {executionResult.cpuInstructions.toLocaleString()}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
                    <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                      <Layers size={12} /> Memory Footprint
                    </span>
                    <span className="font-mono font-bold text-slate-200 text-sm mt-0.5 block">
                      {executionResult.memoryBytes} bytes
                    </span>
                  </div>
                </div>

                {/* Tx Hash */}
                <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
                  <div className="truncate max-w-[220px]">
                    <span className="text-slate-500 block text-[10px]">Tx Hash</span>
                    <span className="font-mono text-slate-300 truncate block">
                      {executionResult.txHash}
                    </span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(executionResult.txHash)}
                    className="p-1.5 text-slate-400 hover:text-slate-200"
                    title="Copy Hash"
                  >
                    {copiedTx ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>

                {/* Return Value */}
                <div>
                  <span className="text-xs font-semibold text-slate-400 block mb-1.5">
                    Return Value ({currentMethod?.returnType}):
                  </span>
                  <div 
                    data-testid="return-value-display"
                    className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-emerald-400 overflow-x-auto"
                  >
                    <pre>{JSON.stringify(executionResult.returnValue, null, 2)}</pre>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Emitted Events Panel */}
          <div className="glass-card p-6 border border-slate-800 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2 border-b border-slate-800 pb-3">
              <Sparkles size={16} className="text-amber-400" /> Emitted Events (Soroban Logs)
            </h3>

            {(!executionResult || executionResult.events.length === 0) ? (
              <div className="py-6 text-center text-slate-500 text-xs">
                No events emitted in current session.
              </div>
            ) : (
              <div className="space-y-3" data-testid="events-log">
                {executionResult.events.map((ev, i) => (
                  <div key={i} className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg space-y-2 text-xs">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono text-amber-400 font-semibold">
                        Topic: [{ev.topic.join(', ')}]
                      </span>
                      <span className="text-slate-500 text-[10px]">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="font-mono text-slate-300 bg-slate-900/80 p-2 rounded text-[11px] overflow-x-auto">
                      <pre>{JSON.stringify(ev.data, null, 2)}</pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContractPlayground;
