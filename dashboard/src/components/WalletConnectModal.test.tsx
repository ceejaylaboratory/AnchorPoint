import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletStore } from '../store/walletStore';
import { WalletConnectModal } from './WalletConnectModal';

const connectWallet = vi.fn();

vi.mock('../lib/wallet/connectWallet', () => ({
  connectWallet: (...args: unknown[]) => connectWallet(...args),
}));

const PUBLIC_KEY = 'GB2NUXFMQMK7WDUDCFUVX7CCXNUHPRGHZG4NPYVEBFSS6BOTT2N2NVGZ';

describe('WalletConnectModal', () => {
  beforeEach(() => {
    connectWallet.mockReset();
    useWalletStore.setState({ publicKey: null, provider: null });
  });

  it('lists Freighter, Albedo, and Rabet', () => {
    render(<WalletConnectModal isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /freighter/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /albedo/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /rabet/i })).toBeTruthy();
  });

  it('stores the public key returned by the selected wallet', async () => {
    connectWallet.mockResolvedValue(PUBLIC_KEY);
    const onClose = vi.fn();
    render(<WalletConnectModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /albedo/i }));

    await waitFor(() => {
      expect(connectWallet).toHaveBeenCalledWith('albedo');
      expect(useWalletStore.getState().publicKey).toBe(PUBLIC_KEY);
      expect(useWalletStore.getState().provider).toBe('albedo');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows an error when the wallet rejects the request', async () => {
    connectWallet.mockRejectedValue(new Error('User rejected the request'));
    render(<WalletConnectModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /freighter/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('User rejected the request');
    expect(useWalletStore.getState().publicKey).toBeNull();
  });

  it('clears the previous error as soon as a retry starts', async () => {
    connectWallet.mockRejectedValueOnce(new Error('User rejected the request'));
    let resolveRetry: (key: string) => void = () => {};
    connectWallet.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveRetry = resolve;
        }),
    );
    const onClose = vi.fn();
    render(<WalletConnectModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /freighter/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('User rejected the request');

    fireEvent.click(screen.getByRole('button', { name: /albedo/i }));

    // While the retry is pending, the stale error must already be gone.
    await waitFor(() => expect(screen.getByText(/waiting for approval/i)).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();

    resolveRetry(PUBLIC_KEY);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('replaces the old error with the new one when a retry also fails', async () => {
    connectWallet
      .mockRejectedValueOnce(new Error('User rejected the request'))
      .mockRejectedValueOnce(new Error('Rabet is not installed'));
    render(<WalletConnectModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /freighter/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('User rejected the request');

    fireEvent.click(screen.getByRole('button', { name: /rabet/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Rabet is not installed'),
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText('User rejected the request')).toBeNull();
  });
});
