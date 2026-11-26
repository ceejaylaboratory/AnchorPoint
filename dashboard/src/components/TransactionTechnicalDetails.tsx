import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, Copy, ExternalLink } from 'lucide-react';
import { CopyableText } from './CopyableText';
import { useCopyFeedback } from '../hooks/useCopyFeedback';
import { getEndpoints, type NetworkType } from '../lib/stellar/networks';
import { isTransactionHash, transactionExplorerLinks } from '../lib/stellar/explorer';
import {
  decodeContractReturnValue,
  decodeEnvelope,
  decodeMetaTree,
  decodeResult,
  stroopsToXlm,
  treeToJson,
} from '../lib/stellar/receiptXdr';
import { jsonReplacer } from '../lib/xdrEvents';

/** On-chain execution data, typically from Horizon's transaction record. */
export interface OnChainDetails {
  hash?: string;
  ledger?: number;
  /** Fee charged in stroops; falls back to the value in the result XDR. */
  feeCharged?: string | number;
  envelopeXdr?: string;
  resultXdr?: string;
  resultMetaXdr?: string;
  successful?: boolean;
}

interface TransactionTechnicalDetailsProps {
  network: NetworkType;
  /** Hash candidate when `details.hash` is absent (e.g. the receipt reference). */
  fallbackHash?: string;
  details?: OnChainDetails;
}

const sectionSummary =
  'flex cursor-pointer list-none items-center gap-2 py-3 text-sm font-semibold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text [&::-webkit-details-marker]:hidden';

const Chevron = () => (
  <ChevronRight
    size={16}
    aria-hidden="true"
    className="shrink-0 transition-transform group-open:rotate-90"
  />
);

const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const { state, copy } = useCopyFeedback();
  return (
    <button
      type="button"
      onClick={() => void copy(value)}
      aria-label={`Copy ${label}`}
      data-copy-state={state}
      className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
    >
      {state === 'copied' ? (
        <Check size={12} className="text-emerald-400" aria-hidden="true" />
      ) : (
        <Copy size={12} aria-hidden="true" />
      )}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  );
};

const formatLeaf = (value: unknown): string =>
  typeof value === 'string' ? `"${value}"` : JSON.stringify(value, jsonReplacer) ?? String(value);

/** Collapsible tree for decoded XDR. Top two levels start expanded. */
export const XdrTree: React.FC<{ data: unknown; label?: string; depth?: number }> = ({
  data,
  label,
  depth = 0,
}) => {
  const isBranch = data !== null && typeof data === 'object';
  const keyLabel = label !== undefined ? <span className="text-sky-300">{label}</span> : null;

  if (!isBranch) {
    return (
      <li className="break-all py-0.5">
        {keyLabel}
        {keyLabel ? <span className="text-slate-500">: </span> : null}
        <span className="text-emerald-300">{formatLeaf(data)}</span>
      </li>
    );
  }

  const entries = Array.isArray(data)
    ? data.map((value, index) => [String(index), value] as const)
    : Object.entries(data as Record<string, unknown>);
  const bracket = Array.isArray(data) ? `[${entries.length}]` : `{${entries.length}}`;

  const children = (
    <ul className="ml-4 border-l border-slate-700/60 pl-3">
      {entries.map(([key, value]) => (
        <XdrTree key={key} label={key} data={value} depth={depth + 1} />
      ))}
    </ul>
  );

  if (depth === 0 && label === undefined) {
    return (
      <ul aria-label="Decoded XDR" className="font-mono text-xs">
        {entries.map(([key, value]) => (
          <XdrTree key={key} label={key} data={value} depth={1} />
        ))}
      </ul>
    );
  }

  return (
    <li className="py-0.5">
      <details open={depth < 2} className="group">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="mr-1 inline-block text-slate-500 transition-transform group-open:rotate-90">▸</span>
          {keyLabel}
          <span className="ml-1 text-slate-500">{bracket}</span>
        </summary>
        {children}
      </details>
    </li>
  );
};

const RawXdrBlock: React.FC<{ title: string; base64: string; tree: unknown | null; error?: string }> = ({
  title,
  base64,
  tree,
  error,
}) => {
  const [view, setView] = useState<'tree' | 'base64'>(tree ? 'tree' : 'base64');
  const slug = title.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="rounded-lg border border-slate-700 p-3" data-testid={`raw-xdr-${slug}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h5>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={`${title} view`} className="inline-flex overflow-hidden rounded-md border border-slate-700 text-xs">
            <button
              type="button"
              aria-pressed={view === 'tree'}
              disabled={!tree}
              onClick={() => setView('tree')}
              className={`px-2 py-1 disabled:opacity-40 ${view === 'tree' ? 'bg-slate-700 text-slate-100' : 'text-slate-400'}`}
            >
              Tree
            </button>
            <button
              type="button"
              aria-pressed={view === 'base64'}
              onClick={() => setView('base64')}
              className={`px-2 py-1 ${view === 'base64' ? 'bg-slate-700 text-slate-100' : 'text-slate-400'}`}
            >
              Base64
            </button>
          </div>
          <CopyButton value={base64} label={`${title} XDR`} />
          {tree ? <CopyButton value={treeToJson(tree)} label={`${title} as JSON`} /> : null}
        </div>
      </div>
      {error ? (
        <p role="status" className="mb-2 text-xs text-amber-400">
          Could not decode: {error}
        </p>
      ) : null}
      <div className="max-h-80 overflow-auto rounded bg-slate-950/60 p-2">
        {view === 'tree' && tree ? (
          <XdrTree data={tree} />
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-slate-300">{base64}</pre>
        )}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <tr>
    <th scope="row" className="py-2 pr-4 align-top font-medium text-slate-400">
      {label}
    </th>
    <td className="py-2 text-slate-200">{children}</td>
  </tr>
);

/**
 * Expandable technical section of the receipt: execution summary, explorer
 * links for the active network, per-operation results and a raw XDR viewer.
 */
export const TransactionTechnicalDetails: React.FC<TransactionTechnicalDetailsProps> = ({
  network,
  fallbackHash,
  details = {},
}) => {
  const passphrase = getEndpoints(network).networkPassphrase;

  const envelope = useMemo(
    () => (details.envelopeXdr ? decodeEnvelope(details.envelopeXdr, passphrase) : null),
    [details.envelopeXdr, passphrase],
  );
  const result = useMemo(() => (details.resultXdr ? decodeResult(details.resultXdr) : null), [details.resultXdr]);
  const returnValue = useMemo(() => decodeContractReturnValue(details.resultMetaXdr), [details.resultMetaXdr]);
  const meta = useMemo(() => (details.resultMetaXdr ? decodeMetaTree(details.resultMetaXdr) : null), [details.resultMetaXdr]);

  const hashCandidates = [details.hash, envelope?.ok ? envelope.summary.hash : null, fallbackHash];
  const hash = hashCandidates.find(isTransactionHash) ?? null;

  const feeCharged = details.feeCharged ?? (result?.ok ? result.summary.feeCharged : undefined);
  const successful = details.successful ?? (result?.ok ? result.summary.success : undefined);
  const hasRawXdr = Boolean(details.envelopeXdr || details.resultXdr || details.resultMetaXdr);

  if (!hash && !hasRawXdr && details.ledger === undefined) return null;

  const links = hash ? transactionExplorerLinks(network, hash, details.ledger) : [];
  const envelopeOps = envelope?.ok ? envelope.summary.operations : [];
  const resultOps = result?.ok ? result.summary.operations : [];
  const opCount = Math.max(envelopeOps.length, resultOps.length);

  return (
    <section
      aria-labelledby="receipt-technical-heading"
      data-testid="receipt-technical-details"
      className="mt-6 border-t border-slate-700 pt-4"
    >
      <h4 id="receipt-technical-heading" className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
        Technical details
        <span className="ml-2 rounded-full border border-slate-600 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-slate-400">
          {getEndpoints(network).label}
        </span>
      </h4>

      <details open className="group border-b border-slate-800">
        <summary className={sectionSummary}>
          <Chevron />
          Execution summary
        </summary>
        <table className="mb-3 w-full text-left text-sm">
          <tbody className="divide-y divide-slate-800">
            {hash ? (
              <Row label="Transaction hash">
                <CopyableText value={hash} label="Transaction hash" truncate={false} className="max-w-full break-all text-xs" />
              </Row>
            ) : null}
            {details.ledger !== undefined ? (
              <Row label="Ledger">
                <CopyableText value={String(details.ledger)} label="Ledger number" truncate={false} />
              </Row>
            ) : null}
            {successful !== undefined ? (
              <Row label="Result">
                <span className={successful ? 'text-emerald-400' : 'text-rose-400'}>
                  {successful ? 'Success' : 'Failed'}
                  {result?.ok ? <span className="ml-2 font-mono text-xs text-slate-400">{result.summary.code}</span> : null}
                </span>
              </Row>
            ) : null}
            {feeCharged !== undefined ? (
              <Row label="Fee paid">
                <span className="font-mono">{stroopsToXlm(feeCharged)}</span>
                <span className="ml-2 text-xs text-slate-500">({String(feeCharged)} stroops)</span>
              </Row>
            ) : null}
            {envelope?.ok ? (
              <>
                <Row label="Source account">
                  <CopyableText value={envelope.summary.source} label="Source account" />
                </Row>
                <Row label="Sequence">
                  <span className="font-mono">{envelope.summary.sequence}</span>
                </Row>
                <Row label="Max fee">
                  <span className="font-mono">{stroopsToXlm(envelope.summary.fee)}</span>
                  {envelope.summary.isFeeBump ? <span className="ml-2 text-xs text-slate-400">fee bump</span> : null}
                </Row>
                {envelope.summary.memo ? (
                  <Row label="Memo">
                    <span className="break-all font-mono">{envelope.summary.memo}</span>
                  </Row>
                ) : null}
              </>
            ) : null}
            {opCount > 0 ? <Row label="Operations">{opCount}</Row> : null}
          </tbody>
        </table>

        {links.length > 0 ? (
          <ul className="mb-4 flex flex-wrap gap-2" aria-label="Block explorer links">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-primary-text hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
                >
                  {link.label}
                  <ExternalLink size={12} aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </details>

      {opCount > 0 || returnValue ? (
        <details className="group border-b border-slate-800">
          <summary className={sectionSummary}>
            <Chevron />
            Operation results
          </summary>
          <div className="mb-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-xs" data-testid="operation-results">
              <thead className="text-slate-400">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">#</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Operation</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Result</th>
                  <th scope="col" className="py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 align-top">
                {Array.from({ length: opCount }, (_, index) => {
                  const op = envelopeOps[index];
                  const res = resultOps[index];
                  const rows = { ...(op?.details ?? {}), ...(res?.details ?? {}) };
                  return (
                    <tr key={index}>
                      <td className="py-2 pr-3 text-slate-500">{index + 1}</td>
                      <td className="py-2 pr-3 font-mono text-slate-200">{op?.type ?? res?.type ?? '—'}</td>
                      <td className={`py-2 pr-3 font-mono ${res ? (res.success ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-500'}`}>
                        {res?.code ?? '—'}
                      </td>
                      <td className="py-2">
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                          {Object.entries(rows).map(([key, value]) => (
                            <React.Fragment key={key}>
                              <dt className="text-slate-400">{key}</dt>
                              <dd className="break-all font-mono text-slate-200">
                                {key === 'Claimable balance ID' ? (
                                  <CopyableText value={value} label="Claimable balance ID" />
                                ) : (
                                  value
                                )}
                              </dd>
                            </React.Fragment>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {returnValue ? (
              <p className="mt-3 text-xs text-slate-300" data-testid="contract-return-value">
                <span className="text-slate-400">Contract return value </span>
                <span className="font-mono text-slate-500">({returnValue.type})</span>:{' '}
                <span className="break-all font-mono">{JSON.stringify(returnValue.value, jsonReplacer)}</span>
              </p>
            ) : null}
          </div>
        </details>
      ) : null}

      {hasRawXdr ? (
        <details className="group">
          <summary className={sectionSummary}>
            <Chevron />
            Raw XDR
          </summary>
          <div className="mb-3 space-y-3">
            {details.envelopeXdr ? (
              <RawXdrBlock
                title="Envelope"
                base64={details.envelopeXdr}
                tree={envelope?.ok ? envelope.tree : null}
                error={envelope && !envelope.ok ? envelope.error : undefined}
              />
            ) : null}
            {details.resultXdr ? (
              <RawXdrBlock
                title="Result"
                base64={details.resultXdr}
                tree={result?.ok ? result.tree : null}
                error={result && !result.ok ? result.error : undefined}
              />
            ) : null}
            {details.resultMetaXdr ? (
              <RawXdrBlock
                title="Result meta"
                base64={details.resultMetaXdr}
                tree={meta?.ok ? meta.tree : null}
                error={meta && !meta.ok ? meta.error : undefined}
              />
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
};

export default TransactionTechnicalDetails;
