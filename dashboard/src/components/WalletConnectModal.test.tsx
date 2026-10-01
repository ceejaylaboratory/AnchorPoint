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
});
