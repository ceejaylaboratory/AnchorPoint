import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LedgerAdapter, stellarDerivationPath } from './LedgerAdapter';

// ---------------------------------------------------------------------------
// stellarDerivationPath
// ---------------------------------------------------------------------------
describe('stellarDerivationPath', () => {
  it('returns the BIP-44 Stellar path for index 0', () => {
    expect(stellarDerivationPath(0)).toBe("44'/148'/0'");
  });

  it('returns the BIP-44 Stellar path for index 1', () => {
    expect(stellarDerivationPath(1)).toBe("44'/148'/1'");
  });

  it('defaults to index 0', () => {
    expect(stellarDerivationPath()).toBe("44'/148'/0'");
  });
});

// ---------------------------------------------------------------------------
// LedgerAdapter.isInstalled
// ---------------------------------------------------------------------------
describe('LedgerAdapter.isInstalled', () => {
  it('returns true when navigator.usb is available', async () => {
    Object.defineProperty(global.navigator, 'usb', { value: {}, configurable: true });
    const adapter = new LedgerAdapter();
    expect(await adapter.isInstalled()).toBe(true);
  });

  it('returns false when neither usb nor hid is available', async () => {
    // Remove usb and hid from navigator
    const nav = global.navigator as any;
    const savedUsb = nav.usb;
    const savedHid = nav.hid;
    delete nav.usb;
    delete nav.hid;

    const adapter = new LedgerAdapter();
    expect(await adapter.isInstalled()).toBe(false);

    if (savedUsb !== undefined) nav.usb = savedUsb;
    if (savedHid !== undefined) nav.hid = savedHid;
  });
});

// ---------------------------------------------------------------------------
// LedgerAdapter.connect — mocked transport
// ---------------------------------------------------------------------------
describe('LedgerAdapter.connect', () => {
  const mockTransport = { close: vi.fn().mockResolvedValue(undefined) };
  const mockPublicKey = 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL';

  beforeEach(() => {
    // Ensure isInstalled returns true
    Object.defineProperty(global.navigator, 'usb', { value: {}, configurable: true });

    vi.doMock('@ledgerhq/hw-transport-webusb', () => ({
      default: { create: vi.fn().mockResolvedValue(mockTransport) },
    }));

    vi.doMock('@ledgerhq/hw-app-str', () => ({
      default: vi.fn().mockImplementation(() => ({
        getPublicKey: vi.fn().mockResolvedValue({ publicKey: mockPublicKey }),
        signTransaction: vi.fn().mockResolvedValue({ signature: Buffer.from('deadbeef', 'hex') }),
      })),
    }));
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('throws a helpful error when WebUSB is not available', async () => {
    const nav = global.navigator as any;
    delete nav.usb;
    delete nav.hid;

    const adapter = new LedgerAdapter();
    await expect(adapter.connect()).rejects.toThrow(/WebUSB is not supported/i);

    Object.defineProperty(global.navigator, 'usb', { value: {}, configurable: true });
  });
});

// ---------------------------------------------------------------------------
// LedgerAdapter.setAccountIndex
// ---------------------------------------------------------------------------
describe('LedgerAdapter.setAccountIndex', () => {
  it('updates the account index', () => {
    const adapter = new LedgerAdapter({ accountIndex: 0 });
    adapter.setAccountIndex(3);
    expect(adapter.getAccountIndex()).toBe(3);
  });

  it('throws for a negative index', () => {
    const adapter = new LedgerAdapter();
    expect(() => adapter.setAccountIndex(-1)).toThrow(/non-negative integer/i);
  });

  it('throws for a non-integer index', () => {
    const adapter = new LedgerAdapter();
    expect(() => adapter.setAccountIndex(1.5)).toThrow(/non-negative integer/i);
  });
});

// ---------------------------------------------------------------------------
// LedgerAdapter.signTransaction — not connected error
// ---------------------------------------------------------------------------
describe('LedgerAdapter.signTransaction', () => {
  it('throws when no transport is active', async () => {
    const adapter = new LedgerAdapter();
    await expect(adapter.signTransaction('some-xdr', 'PUBLIC')).rejects.toThrow(
      /not connected/i
    );
  });
});

// ---------------------------------------------------------------------------
// LedgerAdapter error message helpers (via private wrapAppError)
// ---------------------------------------------------------------------------
describe('LedgerAdapter error wrapping', () => {
  it('recognises Stellar app-not-open status code 0x6e00', async () => {
    // Trigger the private helper indirectly via disconnect (safe path), then
    // test the public-facing error from the app error code.
    const adapter = new LedgerAdapter();
    // Inject a fake transport that raises the app-not-open error on getPublicKey
    (adapter as any).transport = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock('@ledgerhq/hw-app-str', () => ({
      default: vi.fn().mockImplementation(() => ({
        getPublicKey: vi.fn().mockRejectedValue(new Error('Status: 0x6e00')),
      })),
    }));

    // signTransaction path is easier to exercise without real USB
    // We test the error message shaping by calling the private method directly.
    const wrapAppError = (adapter as any).wrapAppError.bind(adapter);
    const err = wrapAppError(new Error('Status: 0x6e00'), 'connect');
    expect(err.message).toMatch(/Stellar app is not open/i);
  });

  it('recognises rejection status code 0x6985', () => {
    const adapter = new LedgerAdapter();
    const wrapAppError = (adapter as any).wrapAppError.bind(adapter);
    const err = wrapAppError(new Error('Status: 0x6985'), 'sign');
    expect(err.message).toMatch(/rejected/i);
  });

  it('recognises locked device status code 0x5515', () => {
    const adapter = new LedgerAdapter();
    const wrapAppError = (adapter as any).wrapAppError.bind(adapter);
    const err = wrapAppError(new Error('Status: 0x5515'), 'connect');
    expect(err.message).toMatch(/locked/i);
  });

  it('recognises disconnection errors', () => {
    const adapter = new LedgerAdapter();
    const wrapAppError = (adapter as any).wrapAppError.bind(adapter);
    const err = wrapAppError(new Error('The device was disconnected'), 'sign');
    expect(err.message).toMatch(/disconnected/i);
  });

  it('recognises no-device-selected transport error', () => {
    const adapter = new LedgerAdapter();
    const wrapTransport = (adapter as any).wrapTransportError.bind(adapter);
    const err = wrapTransport(new Error('No device selected'), 'connect');
    expect(err.message).toMatch(/No Ledger device was selected/i);
  });
});
