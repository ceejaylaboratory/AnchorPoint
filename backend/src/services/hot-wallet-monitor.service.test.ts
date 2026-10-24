import { HotWalletMonitorService, HotWallet } from './hot-wallet-monitor.service';
import type { AlertEmailService } from './alert-email.service';
import { stellarService } from './stellar.service';
import { redis } from '../lib/redis';
import logger from '../utils/logger';
import { notificationService } from './notification.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('./stellar.service');
jest.mock('../lib/redis');
jest.mock('./notification.service', () => ({
  notificationService: { notify: jest.fn().mockResolvedValue(undefined) },
}));
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

function makeService(
  wallets: HotWallet[] = [XLM_WALLET],
  options: {
    alertEmailService?: AlertEmailService;
    alertChannels?: { emailRecipients?: string; notificationUserIds?: string };
  } = {},
) {
  // Reset singleton for each test
  (HotWalletMonitorService as any).instance = undefined;
  return HotWalletMonitorService.getInstance({
    wallets,
    alertCooldownSeconds: 3600,
    alertEmailService: options.alertEmailService,
    alertChannels: options.alertChannels,
  });
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

  it('dispatches SMTP alert email when recipients are configured', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '10.0000000' }]);
    const alertEmailService = {
      sendHotWalletLowBalanceAlert: jest.fn().mockResolvedValue(undefined),
      sendSystemAlert: jest.fn(),
    };

    const svc = makeService([XLM_WALLET], {
      alertEmailService,
      alertChannels: { emailRecipients: 'ops@example.com' },
    });

    await svc.checkWallet(XLM_WALLET);

    expect(alertEmailService.sendHotWalletLowBalanceAlert).toHaveBeenCalledWith(
      'ops@example.com',
      expect.objectContaining({
        walletLabel: 'XLM Hot Wallet',
        currentBalance: 10,
        thresholdAmount: 100,
      }),
    );
  });
});

describe('HotWalletMonitorService — notification service alerts', () => {
  const channels = { notificationUserIds: 'admin-1, admin-2' };

  it('dispatches an alert via the notification service on threshold breach', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '99.9999999' }]);

    const svc = makeService([XLM_WALLET], { alertChannels: channels });
    await svc.checkWallet(XLM_WALLET);

    expect(notificationService.notify).toHaveBeenCalledTimes(2);
    expect(notificationService.notify).toHaveBeenCalledWith('admin-1', expect.stringContaining('Low balance'));
    expect(notificationService.notify).toHaveBeenCalledWith('admin-2', expect.stringContaining('Low balance'));
  });

  it('suppresses repeat alerts while the cooldown interval is active', async () => {
    mockHorizonAccount([{ asset_type: 'native', balance: '50.0000000' }]);
    const store = new Map<string, string>();
    (redis.get as jest.Mock).mockImplementation(async (key: string) => store.get(key) ?? null);
    (redis.set as jest.Mock).mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    });

    const svc = makeService([XLM_WALLET], { alertChannels: channels });
    await svc.checkWallet(XLM_WALLET);
    await svc.checkWallet(XLM_WALLET);

    expect(notificationService.notify).toHaveBeenCalledTimes(2); // first breach only
  });

  it('sends an all-clear once balance recovers above 110% of threshold', async () => {
    (redis.get as jest.Mock).mockImplementation(async (key: string) =>
      key.startsWith('hot_wallet_breach:') ? '1' : null
    );

    mockHorizonAccount([{ asset_type: 'native', balance: '105.0000000' }]);
    const svc = makeService([XLM_WALLET], { alertChannels: channels });
    await svc.checkWallet(XLM_WALLET);
    expect(notificationService.notify).not.toHaveBeenCalled();

    mockHorizonAccount([{ asset_type: 'native', balance: '111.0000000' }]);
    await svc.checkWallet(XLM_WALLET);
    expect(notificationService.notify).toHaveBeenCalledWith('admin-1', expect.stringContaining('All clear'));
    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('hot_wallet_breach:'));
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
