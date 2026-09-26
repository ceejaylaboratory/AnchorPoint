import { useState } from 'react';
import { Wallet2 } from 'lucide-react';
import { connectWallet } from '../lib/wallet/connectWallet';
import { useWalletStore, type WalletProviderId } from '../store/walletStore';
import { Modal } from './Modal';

const PROVIDERS: { id: WalletProviderId; name: string; description: string }[] = [
  { id: 'freighter', name: 'Freighter', description: 'Browser extension for Stellar' },
  { id: 'albedo', name: 'Albedo', description: 'Web signer that opens in a new window' },
  { id: 'rabet', name: 'Rabet', description: 'Browser extension wallet' },
];

type WalletConnectModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const WalletConnectModal = ({ isOpen, onClose }: WalletConnectModalProps) => {
  const setConnected = useWalletStore((state) => state.setConnected);
  const [pending, setPending] = useState<WalletProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (provider: WalletProviderId) => {
    setError(null);
    setPending(provider);
    try {
      const publicKey = await connectWallet(provider);
      setConnected(publicKey, provider);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect wallet.');
    } finally {
      setPending(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
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
              <Wallet2 size={18} aria-hidden="true" />
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
      {error ? (
        <p role="alert" className="mt-4 text-sm text-rose-400">
          {error}
        </p>
      ) : null}
    </Modal>
  );
};

export default WalletConnectModal;
