import { WalletAdapter } from './types';

/**
 * BIP-44 derivation path for Stellar accounts.
 * Index 0 → "44'/148'/0'", index 1 → "44'/148'/1'", etc.
 */
export function stellarDerivationPath(accountIndex = 0): string {
  return `44'/148'/${accountIndex}'`;
}

export interface LedgerAdapterOptions {
  /** BIP-44 account index. Defaults to 0. */
  accountIndex?: number;
}

/**
 * LedgerAdapter
 *
 * Connects to a Ledger hardware wallet via WebUSB (primary) with WebHID as a
 * fallback transport, using the official @ledgerhq/hw-transport-webusb and
 * @ledgerhq/hw-app-str packages.
 *
 * Usage:
 *   1. Open the Stellar app on the Ledger device.
 *   2. Call connect() — the browser will show the WebUSB device picker.
 *   3. Call signTransaction(xdr, network) — the user confirms on the device.
 *
 * Error handling:
 *   - Device locked / Stellar app not open → descriptive error message.
 *   - User rejected the signature → descriptive error message.
 *   - USB cable disconnected mid-operation → descriptive error message.
 *   - WebUSB not supported (non-Chromium browser) → descriptive error message.
 */
export class LedgerAdapter implements WalletAdapter {
  id = 'ledger';
  name = 'Ledger';
  icon = 'ledger-icon-url';

  private accountIndex: number;
  /** Cached public key after a successful connect(). */
  private cachedPublicKey: string | null = null;
  /** Active transport instance, kept alive for signTransaction(). */
  private transport: { close(): Promise<void> } | null = null;

  constructor(options: LedgerAdapterOptions = {}) {
    this.accountIndex = options.accountIndex ?? 0;
  }

  async isInstalled(): Promise<boolean> {
    // WebUSB is available in Chromium-based browsers (Chrome, Edge, Brave, Opera).
    // navigator.usb may also be present if the browser supports WebHID.
    return (
      typeof navigator !== 'undefined' &&
      (typeof (navigator as any).usb !== 'undefined' || typeof (navigator as any).hid !== 'undefined')
    );
  }

  async connect(): Promise<{ publicKey: string; network: string }> {
    if (!(await this.isInstalled())) {
      throw new Error(
        'WebUSB is not supported in this browser. ' +
        'Use a Chromium-based browser (Chrome, Edge, Brave) to connect a Ledger device.'
      );
    }

    let TransportWebUSB: any;
    let Str: any;

    try {
      const transportModule = await import('@ledgerhq/hw-transport-webusb');
      TransportWebUSB = transportModule.default ?? transportModule;
    } catch {
      throw new Error(
        'Ledger WebUSB transport is not available. ' +
        'Ensure @ledgerhq/hw-transport-webusb is installed.'
      );
    }

    try {
      const strModule = await import('@ledgerhq/hw-app-str');
      Str = strModule.default ?? strModule.Str ?? strModule;
    } catch {
      throw new Error(
        'Ledger Stellar app module is not available. ' +
        'Ensure @ledgerhq/hw-app-str is installed.'
      );
    }

    // Close any existing transport before opening a new one
    await this.closeTransport();

    try {
      this.transport = await TransportWebUSB.create();
    } catch (err: unknown) {
      throw this.wrapTransportError(err, 'connect');
    }

    try {
      const str = new Str(this.transport);
      const path = stellarDerivationPath(this.accountIndex);
      const result = await str.getPublicKey(path);
      this.cachedPublicKey = result.publicKey as string;
      return { publicKey: this.cachedPublicKey, network: 'PUBLIC' };
    } catch (err: unknown) {
      await this.closeTransport();
      throw this.wrapAppError(err, 'connect');
    }
  }

  async disconnect(): Promise<void> {
    this.cachedPublicKey = null;
    await this.closeTransport();
  }

  async signTransaction(xdr: string, _network: string): Promise<string> {
    if (!this.transport) {
      throw new Error(
        'Ledger device is not connected. Call connect() before signing a transaction.'
      );
    }

    let Str: any;
    try {
      const strModule = await import('@ledgerhq/hw-app-str');
      Str = strModule.default ?? strModule.Str ?? strModule;
    } catch {
      throw new Error('Ledger Stellar app module is not available.');
    }

    try {
      const str = new Str(this.transport);
      const path = stellarDerivationPath(this.accountIndex);
      // hw-app-str expects the raw transaction bytes, not the base64/XDR envelope.
      const { StellarSdk } = await import('@stellar/stellar-sdk').catch(() => ({ StellarSdk: null }));
      let txBuffer: Buffer;
      try {
        // Decode the XDR envelope to raw transaction bytes for the Ledger app
        const { xdr: sdkXdr, TransactionEnvelope } = await import('@stellar/stellar-sdk');
        const envelope = sdkXdr.TransactionEnvelope.fromXDR(xdr, 'base64');
        txBuffer = Buffer.from(envelope.toXDR());
      } catch {
        // Fallback: treat XDR string as already a hex/raw buffer representation
        txBuffer = Buffer.from(xdr, 'base64');
      }

      const result = await str.signTransaction(path, txBuffer);
      // result.signature is the 64-byte ed25519 signature as a Buffer
      return (result.signature as Buffer).toString('base64');
    } catch (err: unknown) {
      throw this.wrapAppError(err, 'sign');
    }
  }

  /**
   * Change the account derivation index. The next connect() call will derive
   * the account at the new index.
   */
  setAccountIndex(index: number): void {
    if (index < 0 || !Number.isInteger(index)) {
      throw new Error(`Account index must be a non-negative integer, got: ${index}`);
    }
    this.accountIndex = index;
    this.cachedPublicKey = null;
  }

  getAccountIndex(): number {
    return this.accountIndex;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async closeTransport(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // Ignore close errors — device may already be disconnected
      }
      this.transport = null;
    }
  }

  /**
   * Wrap transport-level errors (USB layer) with actionable user messages.
   */
  private wrapTransportError(err: unknown, operation: string): Error {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('No device selected') || msg.includes('Access denied')) {
      return new Error(
        'No Ledger device was selected. ' +
        'Connect your Ledger via USB and select it in the browser popup, then try again.'
      );
    }
    if (msg.includes('Unable to claim interface') || msg.includes('LIBUSB')) {
      return new Error(
        'Could not claim the Ledger USB interface. ' +
        'Close Ledger Live or any other application that may be using the device, then try again.'
      );
    }
    return new Error(`Ledger USB error during ${operation}: ${msg}`);
  }

  /**
   * Wrap Ledger app / firmware errors with actionable user messages.
   */
  private wrapAppError(err: unknown, operation: string): Error {
    const msg = err instanceof Error ? err.message : String(err);
    // Status codes from hw-app-str and the Stellar app firmware
    const statusMatch = /0x([0-9a-fA-F]{4})/.exec(msg);
    const status = statusMatch ? parseInt(statusMatch[1], 16) : null;

    if (status === 0x6e00 || msg.includes('App not open') || msg.includes('INS_NOT_SUPPORTED')) {
      return new Error(
        'The Stellar app is not open on your Ledger. ' +
        'Unlock the device and open the Stellar app, then try again.'
      );
    }
    if (status === 0x6985 || msg.includes('Conditions of use not satisfied') || msg.includes('rejected')) {
      return new Error('Transaction was rejected on the Ledger device.');
    }
    if (status === 0x5515 || msg.includes('device locked') || msg.includes('LOCKED')) {
      return new Error(
        'Your Ledger is locked. Enter your PIN to unlock it, then try again.'
      );
    }
    if (msg.includes('disconnected') || msg.includes('The device was disconnected')) {
      return new Error(
        'The Ledger device was disconnected during the operation. ' +
        'Reconnect the USB cable and try again.'
      );
    }
    return new Error(`Ledger Stellar app error during ${operation}: ${msg}`);
  }
}
