import albedo from '@albedo-link/intent';
import { requestAccess } from '@stellar/freighter-api';
import type { WalletProviderId } from '../../store/walletStore';

type RabetWindow = Window & {
  rabet?: {
    connect: () => Promise<{ publicKey: string }>;
  };
};

type XBullWindow = Window & {
  xBull?: {
    isConnected(): Promise<boolean>;
    getPublicKey(): Promise<string>;
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

  if (provider === 'xbull') {
    const xBull = (window as XBullWindow).xBull;
    if (!xBull) {
      throw new Error('xBull extension is not available.');
    }
    const connected = await xBull.isConnected();
    if (!connected) {
      throw new Error('xBull is not connected. Please unlock the extension and try again.');
    }
    const publicKey = await xBull.getPublicKey();
    if (!publicKey) {
      throw new Error('xBull did not return a public key.');
    }
    return publicKey;
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
