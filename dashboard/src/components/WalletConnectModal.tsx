import { useState } from 'react';
import { Loader2, Wallet2 } from 'lucide-react';
import { connectWallet } from '../lib/wallet/connectWallet';
import { SIGNING_TIMEOUT_MS } from '../lib/wallet/signingGuard';
import { useGuardedWalletRequest } from '../hooks/useGuardedWalletRequest';
import { useWalletStore, type WalletProviderId } from '../store/walletStore';
import { Modal } from './Modal';
import { WalletRequestErrorBanner } from './WalletRequestErrorBanner';

const PROVIDERS: { id: WalletProviderId; name: string; description: string }[] = [
  { id: 'freighter', name: 'Freighter', description: 'Browser extension for Stellar' },
  { id: 'albedo', name: 'Albedo', description: 'Web signer that opens in a new window' },
  { id: 'rabet', name: 'Rabet', description: 'Browser extension wallet' },
];

type WalletConnectModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Overrides the 90s wallet response timeout. Useful in tests. */
  timeoutMs?: number;
};

export const WalletConnectModal = ({ isOpen, onClose, timeoutMs = SIGNING_TIMEOUT_MS }: WalletConnectModalProps) => {
  const setConnected = useWalletStore((state) => state.setConnected);
  const request = useGuardedWalletRequest<string>();
  const [lastProvider, setLastProvider] = useState<WalletProviderId | null>(null);

  const pending = request.status === 'pending' ? lastProvider : null;

  const handleSelect = async (provider: WalletProviderId) => {
    // `run` clears the previous attempt's failure before the new one starts,
    // and a closed popup or unplugged device ends in a timeout, not a hang.
    setLastProvider(provider);
    const publicKey = await request.run(() => connectWallet(provider), { timeoutMs });
    if (publicKey) {
      setConnected(publicKey, provider);
      onClose();
    }
  };

  // Closing abandons any open prompt and discards the last failure so
  // reopening starts from a clean state.
  const handleClose = () => {
    request.cancel();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Connect a wallet"
      description="Choose Freighter, Albedo, or Rabet to share your public key with this dashboard."
      size="lg"
    >
      <div className="space-y-3">
        {PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            disabled={pending !== null}
            onClick={() => {
              void handleSelect(provider.id);
            }}
            className="flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4 text-left transition hover:border-primary/40 disabled:opacity-60"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700">
              {pending === provider.id ? (
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              ) : (
                <Wallet2 size={18} aria-hidden="true" />
              )}
            </span>
            <span>
              <span className="block font-semibold text-slate-100">{provider.name}</span>
              <span className="block text-sm text-slate-400">
                {pending === provider.id ? 'Waiting for approval…' : provider.description}
              </span>
            </span>
          </button>
        ))}
      </div>
      {pending !== null ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-400">
          <span>Approve the request in your wallet. It will time out after {Math.round(timeoutMs / 1000)} seconds.</span>
          <button
            type="button"
            onClick={request.cancel}
            className="rounded-lg border border-slate-700 px-3 py-1.5 font-semibold text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            Cancel
          </button>
        </div>
      ) : null}
      {request.error && lastProvider ? (
        <WalletRequestErrorBanner
          error={request.error}
          onRetry={() => {
            void handleSelect(lastProvider);
          }}
          onDismiss={request.reset}
        />
      ) : null}
    </Modal>
  );
};

export default WalletConnectModal;
