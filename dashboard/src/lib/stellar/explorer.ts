import { getEndpoints, type NetworkType } from './networks';

/**
 * Explorer deep links for the active network. StellarExpert only indexes
 * Testnet and Public, so Futurenet gets Horizon links only.
 */

const STELLAR_EXPERT_BASE = 'https://stellar.expert/explorer';

const STELLAR_EXPERT_SEGMENT: Partial<Record<NetworkType, string>> = {
  TESTNET: 'testnet',
  PUBLIC: 'public',
};

export interface ExplorerLink {
  label: string;
  href: string;
}

const enc = encodeURIComponent;

export function stellarExpertTxUrl(network: NetworkType, hash: string): string | null {
  const segment = STELLAR_EXPERT_SEGMENT[network];
  return segment ? `${STELLAR_EXPERT_BASE}/${segment}/tx/${enc(hash)}` : null;
}

export function stellarExpertLedgerUrl(network: NetworkType, ledger: number): string | null {
  const segment = STELLAR_EXPERT_SEGMENT[network];
  return segment ? `${STELLAR_EXPERT_BASE}/${segment}/ledger/${enc(String(ledger))}` : null;
}

export function horizonTxUrl(network: NetworkType, hash: string): string {
  return `${getEndpoints(network).horizonUrl}/transactions/${enc(hash)}`;
}

export function horizonLedgerUrl(network: NetworkType, ledger: number): string {
  return `${getEndpoints(network).horizonUrl}/ledgers/${enc(String(ledger))}`;
}

/** All available links for a transaction, in display order. */
export function transactionExplorerLinks(
  network: NetworkType,
  hash: string,
  ledger?: number | null,
): ExplorerLink[] {
  const links: ExplorerLink[] = [];
  const expertTx = stellarExpertTxUrl(network, hash);
  if (expertTx) links.push({ label: 'View on StellarExpert', href: expertTx });
  links.push({ label: 'View on Horizon', href: horizonTxUrl(network, hash) });
  if (typeof ledger === 'number' && Number.isFinite(ledger)) {
    const expertLedger = stellarExpertLedgerUrl(network, ledger);
    if (expertLedger) links.push({ label: `Ledger ${ledger} on StellarExpert`, href: expertLedger });
    else links.push({ label: `Ledger ${ledger} on Horizon`, href: horizonLedgerUrl(network, ledger) });
  }
  return links;
}

/** A 64-char hex string, i.e. something an explorer can actually look up. */
export const isTransactionHash = (value: string | undefined | null): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
