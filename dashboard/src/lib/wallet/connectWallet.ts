import albedo from '@albedo-link/intent';
import { requestAccess } from '@stellar/freighter-api';
import type { WalletProviderId } from '../../store/walletStore';

type RabetWindow = Window & {
  rabet?: {
    connect: () => Promise<{ publicKey: string }>;
  };
};

export async function connectWallet(provider: WalletProviderId): Promise<string> {
  if (provider === 'freighter') {
    const result = await requestAccess();
    if (result.error || !result.address) {
      const detail = result.error ? String(result.error) : 'Freighter did not return a public key.';
      throw new Error(detail);
    }
    return result.address;
  }

  if (provider === 'albedo') {
    const result = await albedo.publicKey({});
    if (!result.pubkey) {
      throw new Error('Albedo did not return a public key.');
    }
    return result.pubkey;
  }

  const rabet = (window as RabetWindow).rabet;
  if (!rabet) {
    throw new Error('Rabet extension is not available.');
  }
  const result = await rabet.connect();
  if (!result.publicKey) {
    throw new Error('Rabet did not return a public key.');
  }
  return result.publicKey;
}
