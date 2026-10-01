import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransactionReceipt } from './TransactionReceipt';

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
