import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/request cancelled/i);
    expect(alert).toHaveTextContent(/nothing was signed/i);
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
    expect(await screen.findByRole('alert')).toHaveTextContent(/request cancelled/i);

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
    expect(await screen.findByRole('alert')).toHaveTextContent(/request cancelled/i);

    fireEvent.click(screen.getByRole('button', { name: /rabet/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Rabet is not installed'),
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/request cancelled/i)).toBeNull();
  });

  describe('signing / approval safeguards (#1617)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('times out a prompt the wallet never answers and offers Try Again', async () => {
      vi.useFakeTimers();
      connectWallet.mockImplementationOnce(() => new Promise<string>(() => {}));
      render(<WalletConnectModal isOpen onClose={vi.fn()} timeoutMs={90_000} />);

      fireEvent.click(screen.getByRole('button', { name: /freighter/i }));
      expect(screen.getByText(/waiting for approval/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /freighter/i })).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('data-error-code', 'timeout');
      expect(alert).toHaveTextContent(/did not respond within 90 seconds/i);
      // The spinner is gone and every provider is selectable again.
      expect(screen.queryByText(/waiting for approval/i)).toBeNull();
      expect(screen.getByRole('button', { name: /freighter/i })).not.toBeDisabled();
    });

    it('retries the same provider from the error banner without a reload', async () => {
      connectWallet
        .mockRejectedValueOnce(new Error('User declined access'))
        .mockResolvedValueOnce(PUBLIC_KEY);
      const onClose = vi.fn();
      render(<WalletConnectModal isOpen onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: /rabet/i }));
      await screen.findByRole('alert');

      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(connectWallet).toHaveBeenNthCalledWith(2, 'rabet');
      expect(useWalletStore.getState().publicKey).toBe(PUBLIC_KEY);
    });

    it('lets the user cancel a pending prompt and returns to idle', async () => {
      let resolveLate: (key: string) => void = () => {};
      connectWallet.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveLate = resolve;
          }),
      );
      const onClose = vi.fn();
      render(<WalletConnectModal isOpen onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: /freighter/i }));
      fireEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));

      expect(screen.queryByText(/waiting for approval/i)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();

      // A wallet that answers after the user gave up must not connect.
      await act(async () => {
        resolveLate(PUBLIC_KEY);
      });
      expect(useWalletStore.getState().publicKey).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
