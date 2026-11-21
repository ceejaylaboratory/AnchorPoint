import { Check, HardDrive, Wallet2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { WalletManager, WalletOption } from '../lib/wallet';
import { Modal } from './Modal';

type WalletModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (walletId: string) => void;
  children?: ReactNode;
};

/** Instructions shown inline when the user clicks the Ledger option. */
const LedgerSetupInstructions = () => (
  <ol className="mt-3 space-y-1.5 rounded-xl border border-amber-800/40 bg-amber-950/30 p-4 text-sm text-amber-200">
    <li className="font-semibold text-amber-100">Before connecting your Ledger:</li>
    <li>1. Connect the device via USB and enter your PIN to unlock it.</li>
    <li>2. Open the <strong>Stellar</strong> app on the device.</li>
    <li>3. When prompted, select your device in the browser popup.</li>
    <li>4. To sign a transaction, review the details on the device screen and press both buttons to confirm.</li>
  </ol>
);

/**
 * Wallet provider picker. Built on {@link Modal} so it inherits the shared
 * focus trap, Escape handling and `role="dialog"` / `aria-modal` wiring.
 * Options are loaded from WalletManager so Freighter, Albedo, Rabet, xBull,
 * and Ledger all appear with live installed/unavailable state.
 */
export const WalletModal = ({ isOpen, onClose, onSelect, children }: WalletModalProps) => {
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingLedger, setPendingLedger] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      setPendingLedger(false);
      const walletManager = WalletManager.getInstance();
      walletManager.getWalletOptions().then((options) => {
        setWalletOptions(options);
        setIsLoading(false);
      });
    }
  }, [isOpen]);

  const handleSelect = (id: string) => {
    if (id === 'ledger') {
      // Show setup instructions before forwarding the selection
      setPendingLedger(true);
      return;
    }
    onSelect(id);
  };

  const handleLedgerConfirm = () => {
    setPendingLedger(false);
    onSelect('ledger');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Choose your provider"
      description="Connect a wallet to sign transactions from this dashboard."
      size="lg"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-slate-400">Loading wallet options...</div>
        </div>
      ) : (
        <div className="space-y-3">
          {walletOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option.id)}
              disabled={!option.installed}
              className={`relative flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-gradient-to-r p-4 text-left transition hover:border-primary/40 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text disabled:opacity-50 disabled:hover:border-slate-800 disabled:hover:bg-slate-950 ${option.accent}`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-950/70">
                {option.id === 'ledger' ? (
                  <HardDrive size={18} aria-hidden="true" />
                ) : (
                  <Wallet2 size={18} aria-hidden="true" />
                )}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-slate-100">{option.name}</p>
                <p className="text-sm text-slate-400">{option.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {option.installed ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
                    <Check size={12} aria-hidden="true" />
                    {option.id === 'ledger' ? 'Supported' : 'Installed'}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
                    <X size={12} aria-hidden="true" />
                    Not available
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {pendingLedger && (
        <div className="mt-4">
          <LedgerSetupInstructions />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingLedger(false)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLedgerConfirm}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Connect Ledger
            </button>
          </div>
        </div>
      )}

      {children ? (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-400">
          {children}
        </div>
      ) : null}
    </Modal>
  );
};

export default WalletModal;
