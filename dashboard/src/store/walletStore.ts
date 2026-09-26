import { create } from 'zustand';

export type WalletProviderId = 'freighter' | 'albedo' | 'rabet';

type WalletState = {
  publicKey: string | null;
  provider: WalletProviderId | null;
  setConnected: (publicKey: string, provider: WalletProviderId) => void;
  disconnect: () => void;
};

export const useWalletStore = create<WalletState>((set) => ({
  publicKey: null,
  provider: null,
  setConnected: (publicKey, provider) => set({ publicKey, provider }),
  disconnect: () => set({ publicKey: null, provider: null }),
}));
