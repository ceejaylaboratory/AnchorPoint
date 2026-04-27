import { HotWalletMonitorService, HotWallet, AlertPayload } from './hot-wallet-monitor.service';
import { stellarService } from './stellar.service';
import { redis } from '../lib/redis';
import logger from '../utils/logger';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('./stellar.service');
jest.mock('../lib/redis');
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('./metrics.service', () => ({
  metricsService: {
    getRegistry: jest.fn().mockReturnValue({
      registerMetric: jest.fn(),
    }),
    incrementError: jest.fn(),
  },
}));

// Stub prom-client so Gauge doesn't actually register
jest.mock('prom-client', () => {
  const actual = jest.requireActual('prom-client');
  return {
    ...actual,
    Gauge: jest.fn().mockImplementation(() => ({
      set: jest.fn(),
    })),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const XLM_WALLET: HotWallet = {
  label: 'XLM Hot Wallet',
  publicKey: 'GABC1234',
  assetCode: 'XLM',
  thresholdAmount: 100,
};

const USDC_WALLET: HotWallet = {
  label: 'USDC Hot Wallet',
  publicKey: 'GDEF5678',
  assetCode: 'USDC',
  assetIssuer: 'GCIRCLE',
  thresholdAmount: 500,
};

function makeService(wallets: HotWallet[] = [XLM_WALLET]) {
  // Reset singleton for each test
  (HotWalletMonitorService as any).instance = undefined;
  return HotWalletMonitorService.getInstance({ wallets, alertCooldownSeconds: 3600 });
}

function mockHorizonAccount(balances: object[]) {
  const mockServer = { loadAccount: jest.fn().mockResolvedValue({ balances }) };
  (stellarService.getHorizonServer as jest.Mock).mockReturnValue(mockServer);
  return mockServer;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (redis.get as jest.Mock).mockResolvedValue(null);  // no cooldown by default
  (redis.set as jest.Mock).mockResolvedValue('OK');
});

describe('HotWalletMonitorService.checkWallet', () => {
  it('returns a snapshot with correct balance for XLM', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '250.0000000' }]);
    const svc = makeService();
    const snap = await svc.checkWallet(XLM_WALLET);

    expect(snap.balance).toBe(250);
    expect(snap.belowThreshold).toBe(false);
    expect(snap.wallet).toBe(XLM_WALLET);
  });

  it('detects balance below threshold for XLM', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '50.0000000' }]);
    const svc = makeService();
    const snap = await svc.checkWallet(XLM_WALLET);

    expect(snap.balance).toBe(50);
    expect(snap.belowThreshold).toBe(true);
  });

  it('resolves correct balance for non-native asset (USDC)', async () => {
    mockHorizonAccount([
      { asset_type: 'native', balance: '999.0000000' },
      {
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: 'GCIRCLE',
        balance: '200.0000000',
      },
    ]);
    const svc = makeService([USDC_WALLET]);
    const snap = await svc.checkWallet(USDC_WALLET);

    expect(snap.balance).toBe(200);
    expect(snap.belowThreshold).toBe(true); // 200 < 500 threshold
  });

  it('returns balance 0 when asset not present on account', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '999.0000000' }]);
    const svc = makeService([USDC_WALLET]);
    const snap = await svc.checkWallet(USDC_WALLET);

    expect(snap.balance).toBe(0);
    expect(snap.belowThreshold).toBe(true);
  });

  it('returns balance -1 and logs error when Horizon call fails', async () => {
    (stellarService.getHorizonServer as jest.Mock).mockReturnValue({
      loadAccount: jest.fn().mockRejectedValue(new Error('network error')),
    });

    const svc = makeService();
    const snap = await svc.checkWallet(XLM_WALLET);

    expect(snap.balance).toBe(-1);
    expect(snap.belowThreshold).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      '[HotWalletMonitor] Failed to check wallet',
      expect.objectContaining({ wallet: XLM_WALLET.label })
    );
  });
});

describe('HotWalletMonitorService — alert de-duplication', () => {
  it('sends alert when balance is below threshold and no cooldown active', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '10.0000000' }]);
    (redis.get as jest.Mock).mockResolvedValue(null);

    const svc = makeService();
    await svc.checkWallet(XLM_WALLET);

    // Alert should have been logged
    expect(logger.error).toHaveBeenCalledWith(
      '[HotWalletMonitor] LOW BALANCE ALERT',
      expect.objectContaining({ alert: expect.objectContaining({ walletLabel: 'XLM Hot Wallet' }) })
    );
    // Cooldown key should have been set
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(XLM_WALLET.publicKey),
      '1',
      'EX',
      3600
    );
  });

  it('suppresses alert when cooldown key exists in Redis', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '10.0000000' }]);
    (redis.get as jest.Mock).mockResolvedValue('1'); // cooldown active

    const svc = makeService();
    await svc.checkWallet(XLM_WALLET);

    expect(logger.error).not.toHaveBeenCalledWith(
      '[HotWalletMonitor] LOW BALANCE ALERT',
      expect.anything()
    );
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('does not alert when balance is above threshold', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '999.0000000' }]);

    const svc = makeService();
    await svc.checkWallet(XLM_WALLET);

    expect(logger.error).not.toHaveBeenCalledWith(
      '[HotWalletMonitor] LOW BALANCE ALERT',
      expect.anything()
    );
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('HotWalletMonitorService.checkAll', () => {
  it('returns a snapshot per wallet', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '500.0000000' }]);

    const svc = makeService([XLM_WALLET, { ...XLM_WALLET, label: 'Wallet B', publicKey: 'GXYZ' }]);
    const snapshots = await svc.checkAll();

    expect(snapshots).toHaveLength(2);
    expect(snapshots.every((s) => s.balance === 500)).toBe(true);
  });

  it('logs warning when any wallet is below threshold', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '1.0000000' }]);

    const svc = makeService();
    await svc.checkAll();

    expect(logger.warn).toHaveBeenCalledWith(
      '[HotWalletMonitor] Wallets below threshold',
      expect.objectContaining({ count: 1 })
    );
  });

  it('logs info when all wallets are above threshold', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '999.0000000' }]);

    const svc = makeService();
    await svc.checkAll();

    expect(logger.info).toHaveBeenCalledWith(
      '[HotWalletMonitor] All wallets above threshold'
    );
  });
});

describe('HotWalletMonitorService start/stop', () => {
  it('start() runs checkAll immediately', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '999.0000000' }]);
    const svc = makeService();
    const spy = jest.spyOn(svc, 'checkAll');

    svc.start();
    await Promise.resolve(); // flush microtasks

    expect(spy).toHaveBeenCalledTimes(1);
    svc.stop();
  });

  it('stop() prevents further polling', () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '999.0000000' }]);
    const svc = makeService();
    svc.start();
    svc.stop();

    expect(logger.info).toHaveBeenCalledWith('[HotWalletMonitor] Stopped');
  });

  it('calling start() twice only starts one loop', () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '999.0000000' }]);
    const svc = makeService();
    svc.start();
    svc.start(); // second call

    expect(logger.warn).toHaveBeenCalledWith(
      '[HotWalletMonitor] Already running — ignoring start()'
    );
    svc.stop();
  });
});
