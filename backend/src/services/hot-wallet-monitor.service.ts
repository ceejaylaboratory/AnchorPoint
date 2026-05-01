import { Horizon } from '@stellar/stellar-sdk';
import { stellarService } from './stellar.service';
import { metricsService } from './metrics.service';
import { redis } from '../lib/redis';
import logger from '../utils/logger';
import promClient, { Gauge } from 'prom-client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HotWallet {
  /** Human-readable label, e.g. "XLM withdrawal wallet" */
  label: string;
  /** Stellar public key (G…) */
  publicKey: string;
  /** Asset code to monitor, e.g. "XLM" or "USDC" */
  assetCode: string;
  /** Issuer address – omit or set to "native" for XLM */
  assetIssuer?: string;
  /** Alert when balance falls below this value (in stroops for XLM, or token units) */
  thresholdAmount: number;
}

export interface WalletBalanceSnapshot {
  wallet: HotWallet;
  balance: number;
  belowThreshold: boolean;
  checkedAt: string;
}

export interface AlertPayload {
  walletLabel: string;
  publicKey: string;
  assetCode: string;
  currentBalance: number;
  thresholdAmount: number;
  checkedAt: string;
}

export interface AlertChannelConfig {
  /** Slack incoming-webhook URL */
  slackWebhookUrl?: string;
  /** Comma-separated list of email recipients */
  emailRecipients?: string;
  /** Any custom HTTP endpoint that accepts POST { alert: AlertPayload } */
  customWebhookUrl?: string;
}

export interface HotWalletMonitorConfig {
  /** Wallets to watch */
  wallets: HotWallet[];
  /** How often to poll, in milliseconds (default: 60 000) */
  intervalMs?: number;
  /** Alert channel configuration */
  alertChannels?: AlertChannelConfig;
  /** Redis key TTL for de-duplication, in seconds (default: 3600) */
  alertCooldownSeconds?: number;
}

// ─── Prometheus gauges ────────────────────────────────────────────────────────

const walletBalanceGauge = new Gauge({
  name: 'anchorpoint_hot_wallet_balance',
  help: 'Current balance of a monitored hot wallet',
  labelNames: ['wallet_label', 'public_key', 'asset_code'],
  registers: [metricsService.getRegistry()],
});

const walletBelowThresholdGauge = new Gauge({
  name: 'anchorpoint_hot_wallet_below_threshold',
  help: '1 if the wallet balance is below threshold, 0 otherwise',
  labelNames: ['wallet_label', 'public_key', 'asset_code'],
  registers: [metricsService.getRegistry()],
});

// ─── Service ──────────────────────────────────────────────────────────────────

export class HotWalletMonitorService {
  private static instance: HotWalletMonitorService;

  private config: HotWalletMonitorConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly COOLDOWN_KEY_PREFIX = 'hot_wallet_alert:';

  private constructor(config: HotWalletMonitorConfig) {
    this.config = {
      intervalMs: 60_000,
      alertCooldownSeconds: 3_600,
      alertChannels: {
        slackWebhookUrl: process.env.ALERT_SLACK_WEBHOOK_URL,
        emailRecipients: process.env.ALERT_EMAIL_RECIPIENTS,
        customWebhookUrl: process.env.ALERT_WEBHOOK_URL,
      },
      ...config,
    };
  }

  public static getInstance(config?: HotWalletMonitorConfig): HotWalletMonitorService {
    if (!HotWalletMonitorService.instance) {
      if (!config) {
        throw new Error('HotWalletMonitorService must be initialised with a config on first call');
      }
      HotWalletMonitorService.instance = new HotWalletMonitorService(config);
    }
    return HotWalletMonitorService.instance;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Start the polling loop. Safe to call multiple times — only one loop runs. */
  public start(): void {
    if (this.timer) {
      logger.warn('[HotWalletMonitor] Already running — ignoring start()');
      return;
    }

    logger.info('[HotWalletMonitor] Starting', {
      wallets: this.config.wallets.map((w) => w.label),
      intervalMs: this.config.intervalMs,
    });

    // Run immediately, then on interval
    void this.checkAll();
    this.timer = setInterval(() => void this.checkAll(), this.config.intervalMs!);
  }

  /** Stop the polling loop. */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[HotWalletMonitor] Stopped');
    }
  }

  /** Run a single check cycle — useful for testing or manual triggers. */
  public async checkAll(): Promise<WalletBalanceSnapshot[]> {
    const snapshots = await Promise.all(
      this.config.wallets.map((w) => this.checkWallet(w))
    );

    const below = snapshots.filter((s) => s.belowThreshold);
    if (below.length > 0) {
      logger.warn('[HotWalletMonitor] Wallets below threshold', {
        count: below.length,
        wallets: below.map((s) => s.wallet.label),
      });
    } else {
      logger.info('[HotWalletMonitor] All wallets above threshold');
    }

    return snapshots;
  }

  /** Check a single wallet and fire alerts if needed. */
  public async checkWallet(wallet: HotWallet): Promise<WalletBalanceSnapshot> {
    const checkedAt = new Date().toISOString();

    try {
      const balance = await this.fetchBalance(wallet);
      const belowThreshold = balance < wallet.thresholdAmount;

      // Update Prometheus
      const labels = {
        wallet_label: wallet.label,
        public_key: wallet.publicKey,
        asset_code: wallet.assetCode,
      };
      walletBalanceGauge.set(labels, balance);
      walletBelowThresholdGauge.set(labels, belowThreshold ? 1 : 0);

      const snapshot: WalletBalanceSnapshot = {
        wallet,
        balance,
        belowThreshold,
        checkedAt,
      };

      if (belowThreshold) {
        await this.handleAlert(snapshot);
      }

      return snapshot;
    } catch (error) {
      logger.error('[HotWalletMonitor] Failed to check wallet', {
        wallet: wallet.label,
        publicKey: wallet.publicKey,
        error: error instanceof Error ? error.message : String(error),
      });

      metricsService.incrementError('hot_wallet_check_failed', wallet.label);

      return {
        wallet,
        balance: -1,
        belowThreshold: false,
        checkedAt,
      };
    }
  }

  // ── Balance fetching ────────────────────────────────────────────────────────

  private async fetchBalance(wallet: HotWallet): Promise<number> {
    const server = stellarService.getHorizonServer();
    const account = await server.loadAccount(wallet.publicKey);

    const isNative =
      wallet.assetCode === 'XLM' &&
      (!wallet.assetIssuer || wallet.assetIssuer === 'native');

    for (const b of account.balances) {
      if (isNative && b.asset_type === 'native') {
        return parseFloat(b.balance);
      }

      if (
        !isNative &&
        (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
        b.asset_code === wallet.assetCode &&
        b.asset_issuer === wallet.assetIssuer
      ) {
        return parseFloat(b.balance);
      }
    }

    // Asset not found in account balances → treat as zero
    logger.warn('[HotWalletMonitor] Asset not found on account — treating as 0', {
      wallet: wallet.label,
      assetCode: wallet.assetCode,
    });
    return 0;
  }

  // ── Alert handling ──────────────────────────────────────────────────────────

  private async handleAlert(snapshot: WalletBalanceSnapshot): Promise<void> {
    const cooldownKey = `${this.COOLDOWN_KEY_PREFIX}${snapshot.wallet.publicKey}:${snapshot.wallet.assetCode}`;

    // De-duplicate: skip if we already alerted within the cooldown window
    const alreadyAlerted = await redis.get(cooldownKey);
    if (alreadyAlerted) {
      logger.debug('[HotWalletMonitor] Alert suppressed (cooldown active)', {
        wallet: snapshot.wallet.label,
        cooldownKey,
      });
      return;
    }

    const payload: AlertPayload = {
      walletLabel: snapshot.wallet.label,
      publicKey: snapshot.wallet.publicKey,
      assetCode: snapshot.wallet.assetCode,
      currentBalance: snapshot.balance,
      thresholdAmount: snapshot.wallet.thresholdAmount,
      checkedAt: snapshot.checkedAt,
    };

    logger.error('[HotWalletMonitor] LOW BALANCE ALERT', { alert: payload });

    const channels = this.config.alertChannels ?? {};
    await Promise.allSettled([
      channels.slackWebhookUrl ? this.sendSlackAlert(channels.slackWebhookUrl, payload) : Promise.resolve(),
      channels.emailRecipients ? this.sendEmailAlert(channels.emailRecipients, payload) : Promise.resolve(),
      channels.customWebhookUrl ? this.sendCustomWebhook(channels.customWebhookUrl, payload) : Promise.resolve(),
    ]);

    // Mark as alerted — suppress duplicates for cooldown period
    await redis.set(cooldownKey, '1', 'EX', this.config.alertCooldownSeconds!);
  }

  // ── Alert channels ──────────────────────────────────────────────────────────

  private async sendSlackAlert(webhookUrl: string, alert: AlertPayload): Promise<void> {
    const message = {
      text: '🚨 *Hot Wallet Low Balance Alert*',
      attachments: [
        {
          color: 'danger',
          fields: [
            { title: 'Wallet', value: alert.walletLabel, short: true },
            { title: 'Asset', value: alert.assetCode, short: true },
            { title: 'Current Balance', value: String(alert.currentBalance), short: true },
            { title: 'Threshold', value: String(alert.thresholdAmount), short: true },
            { title: 'Public Key', value: alert.publicKey, short: false },
            { title: 'Detected At', value: alert.checkedAt, short: false },
          ],
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`Slack responded ${response.status}`);
    }

    logger.info('[HotWalletMonitor] Slack alert sent', { wallet: alert.walletLabel });
  }

  private async sendEmailAlert(recipients: string, alert: AlertPayload): Promise<void> {
    // This project has no email transport wired up yet.
    // Log the intent so an operator / future SMTP integration can act on it.
    logger.warn('[HotWalletMonitor] Email alert (no transport configured — log only)', {
      recipients,
      alert,
    });

    // TODO: wire up nodemailer / SendGrid / SES here when an SMTP service is added.
    // Example:
    //   await mailer.sendMail({
    //     to: recipients,
    //     subject: `[AnchorPoint] Low Balance: ${alert.walletLabel}`,
    //     text: formatEmailBody(alert),
    //   });
  }

  private async sendCustomWebhook(url: string, alert: AlertPayload): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert }),
    });

    if (!response.ok) {
      throw new Error(`Custom webhook responded ${response.status}`);
    }

    logger.info('[HotWalletMonitor] Custom webhook alert sent', { wallet: alert.walletLabel });
  }
}

// ─── Singleton factory (env-driven defaults) ──────────────────────────────────

export function createMonitorFromEnv(): HotWalletMonitorService {
  // Wallets are supplied via environment in JSON, e.g.:
  // HOT_WALLETS='[{"label":"Main XLM","publicKey":"G...","assetCode":"XLM","thresholdAmount":100}]'
  const walletsRaw = process.env.HOT_WALLETS;
  const wallets: HotWallet[] = walletsRaw ? JSON.parse(walletsRaw) : [];

  return HotWalletMonitorService.getInstance({
    wallets,
    intervalMs: parseInt(process.env.HOT_WALLET_CHECK_INTERVAL_MS ?? '60000', 10),
    alertCooldownSeconds: parseInt(process.env.HOT_WALLET_ALERT_COOLDOWN_SEC ?? '3600', 10),
    alertChannels: {
      slackWebhookUrl: process.env.ALERT_SLACK_WEBHOOK_URL,
      emailRecipients: process.env.ALERT_EMAIL_RECIPIENTS,
      customWebhookUrl: process.env.ALERT_WEBHOOK_URL,
    },
  });
}

export const hotWalletMonitorService = createMonitorFromEnv();
export default hotWalletMonitorService;
