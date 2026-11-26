import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Account, Asset, Claimant, Networks, Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { TransactionReceipt } from './TransactionReceipt';
import { NetworkProvider } from '../contexts/NetworkContext';

const baseTransaction = {
  id: 'tx-042',
  type: 'Deposit' as const,
  asset: 'USDC',
  amount: 1250,
  status: 'Completed',
  date: '2026-08-20',
  reference: 'HASH-9F2C1A8B3D4E5F60718293A4B5C6D7E8F9A0B1C2D3E4F5061728394A5B6C7D8',
  fees: 12.5,
  anchorSignature: 'SIG-8C4F2A7E9B1D5C6A',
};

const urlMock = vi.fn();
const revokeMock = vi.fn();
const clickMock = vi.fn();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TransactionReceipt', () => {
  it('renders the official anchor stamp and asset breakdown', () => {
    render(<TransactionReceipt transaction={baseTransaction} />);

    expect(screen.getByLabelText('Verified by AnchorPoint')).toBeTruthy();
    expect(screen.getByText('Transaction Receipt')).toBeTruthy();
    expect(screen.getByText('HASH-9F2C1A8B3D4E5F60718293A4B5C6D7E8F9A0B1C2D3E4F5061728394A5B6C7D8')).toBeTruthy();
    expect(screen.getByText('Net Amount')).toBeTruthy();
    expect(screen.getByText('$1,237.50')).toBeTruthy();
  });

  it('matches its rendered layout snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'));
    const { container } = render(<TransactionReceipt transaction={baseTransaction} />);
    expect(container.firstChild).toMatchSnapshot();
    vi.useRealTimers();
  });

  it('triggers the print handler when Print Receipt is clicked', () => {
    const onPrint = vi.fn();
    render(<TransactionReceipt transaction={baseTransaction} onPrint={onPrint} />);

    fireEvent.click(screen.getByRole('button', { name: /print receipt/i }));
    expect(onPrint).toHaveBeenCalledTimes(1);
  });

  it('downloads a standalone receipt file when Save Receipt is clicked', () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(urlMock);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeMock);
    const originalCreateElement = document.createElement.bind(document);
    let capturedLink: HTMLAnchorElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = originalCreateElement(tag);
      if (tag === 'a') {
        capturedLink = element as HTMLAnchorElement;
        element.click = clickMock;
      }
      return element;
    }) as any);

    render(<TransactionReceipt transaction={baseTransaction} />);
    fireEvent.click(screen.getByRole('button', { name: /save receipt/i }));

    expect(urlMock).toHaveBeenCalledTimes(1);
    expect(clickMock).toHaveBeenCalledTimes(1);
    expect((capturedLink as any)?.download).toBe('AnchorPoint_Receipt_tx-042.html');
    expect(revokeMock).toHaveBeenCalledTimes(1);
  });
});

const SOURCE = 'GDLYNIYJNNGXGKNKDPPBWELTNBRGLIQOIUQ6XEMFWOWOUPAILRL67TV3';
const DEST = 'GC2I5JAWAGDP4MMKZ6VO3F6D5ZSVPUBUXQURXYRXJ7VQS7TFZADYZGJQ';
const TX_HASH = 'a'.repeat(64);

const envelopeXdr = new TransactionBuilder(new Account(SOURCE, '100'), {
  fee: '100',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.payment({ destination: DEST, asset: Asset.native(), amount: '12.5' }))
  .addOperation(
    Operation.createClaimableBalance({ asset: Asset.native(), amount: '1', claimants: [new Claimant(DEST)] }),
  )
  .setTimeout(0)
  .build()
  .toEnvelope()
  .toXDR('base64');

const resultXdr = new xdr.TransactionResult({
  feeCharged: new xdr.Int64(200),
  result: xdr.TransactionResultResult.txSuccess([
    xdr.OperationResult.opInner(xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess())),
    xdr.OperationResult.opInner(
      xdr.OperationResultTr.createClaimableBalance(
        xdr.CreateClaimableBalanceResult.createClaimableBalanceSuccess(
          xdr.ClaimableBalanceId.claimableBalanceIdTypeV0(Buffer.alloc(32, 7)),
        ),
      ),
    ),
  ]),
  ext: new xdr.TransactionResultExt(0),
}).toXDR('base64');

const onChain = { hash: TX_HASH, ledger: 51234, envelopeXdr, resultXdr };

describe('TransactionReceipt technical details (#1619)', () => {
  it('stays hidden when there is no on-chain data or real hash', () => {
    render(<TransactionReceipt transaction={baseTransaction} />);
    expect(screen.queryByTestId('receipt-technical-details')).toBeNull();
  });

  it('shows the execution summary with copyable hash, ledger and fee paid', () => {
    render(<TransactionReceipt transaction={baseTransaction} onChain={onChain} network="TESTNET" />);

    const section = screen.getByTestId('receipt-technical-details');
    expect(within(section).getByText(TX_HASH)).toBeTruthy();
    expect(within(section).getByRole('button', { name: /copy transaction hash/i })).toBeTruthy();
    expect(within(section).getByText('51234')).toBeTruthy();
    expect(within(section).getByRole('button', { name: /copy ledger number/i })).toBeTruthy();
    const feeRow = within(section).getByText('Fee paid').closest('tr')!;
    expect(within(feeRow).getByText('0.00002 XLM')).toBeTruthy();
    expect(within(feeRow).getByText('(200 stroops)')).toBeTruthy();
    const resultRow = within(section).getByRole('rowheader', { name: 'Result' }).closest('tr')!;
    expect(resultRow).toHaveTextContent('Success');
    expect(within(resultRow).getByText('txSuccess')).toBeTruthy();
  });

  it('links to testnet explorers in a new tab with safe rel attributes', () => {
    render(<TransactionReceipt transaction={baseTransaction} onChain={onChain} network="TESTNET" />);

    const links = within(screen.getByRole('list', { name: /block explorer links/i })).getAllByRole('link');
    const hrefs = links.map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`,
      `https://horizon-testnet.stellar.org/transactions/${TX_HASH}`,
      'https://stellar.expert/explorer/testnet/ledger/51234',
    ]);
    links.forEach((link) => {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.getAttribute('rel')).toContain('noreferrer');
    });
  });

  it('uses public-network explorers on mainnet', () => {
    render(<TransactionReceipt transaction={baseTransaction} onChain={onChain} network="PUBLIC" />);
    expect(screen.getByRole('link', { name: /view on stellarexpert/i }).getAttribute('href')).toContain(
      '/explorer/public/tx/',
    );
    expect(
      screen.getByRole('link', { name: /view on horizon/i }).getAttribute('href'),
    ).toBe(`https://horizon.stellar.org/transactions/${TX_HASH}`);
  });

  it('falls back to the active network from NetworkProvider', () => {
    render(
      <NetworkProvider apiBaseUrl="http://localhost" initialNetwork="PUBLIC" createServers={() => ({}) as never}>
        <TransactionReceipt transaction={baseTransaction} onChain={onChain} />
      </NetworkProvider>,
    );
    expect(screen.getByRole('link', { name: /view on horizon/i }).getAttribute('href')).toContain(
      'horizon.stellar.org',
    );
  });

  it('formats operation results into a table, including the claimable balance ID', () => {
    render(<TransactionReceipt transaction={baseTransaction} onChain={onChain} network="TESTNET" />);

    const table = screen.getByTestId('operation-results');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('payment')).toBeTruthy();
    expect(within(rows[0]).getByText('paymentSuccess')).toBeTruthy();
    expect(within(rows[0]).getByText(DEST)).toBeTruthy();
    expect(within(rows[1]).getByText('createClaimableBalanceSuccess')).toBeTruthy();
    expect(within(rows[1]).getByRole('button', { name: /copy claimable balance id/i })).toBeTruthy();
  });

  it('shows raw XDR as a decoded tree and as copyable base64', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<TransactionReceipt transaction={baseTransaction} onChain={onChain} network="TESTNET" />);

    const block = screen.getByTestId('raw-xdr-envelope');
    // Tree view is the default when the XDR decodes.
    expect(within(block).getByRole('list', { name: 'Decoded XDR' })).toBeTruthy();
    expect(within(block).getAllByText('envelopeTypeTx').length).toBeGreaterThan(0);

    fireEvent.click(within(block).getByRole('button', { name: 'Base64' }));
    expect(within(block).getByText(envelopeXdr)).toBeTruthy();

    fireEvent.click(within(block).getByRole('button', { name: /copy envelope xdr/i }));
    expect(writeText).toHaveBeenCalledWith(envelopeXdr);
  });

  it('reports undecodable XDR without breaking the receipt', () => {
    render(
      <TransactionReceipt
        transaction={baseTransaction}
        onChain={{ hash: TX_HASH, envelopeXdr: 'definitely-not-xdr' }}
        network="TESTNET"
      />,
    );
    const block = screen.getByTestId('raw-xdr-envelope');
    expect(within(block).getByRole('status')).toHaveTextContent(/could not decode/i);
    expect(within(block).getByText('definitely-not-xdr')).toBeTruthy();
    expect(screen.getByText('Transaction Receipt')).toBeTruthy();
  });
});

