import { stellarService } from './stellar.service';
import { metricsService } from './metrics.service';
import { redis } from '../lib/redis';
import { smtpService } from '../lib/smtp.service';
import prisma from '../lib/prisma';
import type { AlertPayload } from '../types/alerts';
import logger from '../utils/logger';
import promClient, { Counter, Gauge } from 'prom-client';
import { type AlertEmailService, SmtpAlertEmailService } from './alert-email.service';
import { notificationService } from './notification.service';

export type { AlertPayload } from '../types/alerts';

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

export interface AlertChannelConfig {
  /** Slack incoming-webhook URL */
  slackWebhookUrl?: string;
  /** Comma-separated list of email recipients */
  emailRecipients?: string;
  /** Any custom HTTP endpoint that accepts POST { alert: AlertPayload } */
  customWebhookUrl?: string;
  /** Comma-separated list of user ids notified via the notification service (email/SMS/push) */
  notificationUserIds?: string;
}

export interface HotWalletMonitorConfig {
  /** Wallets to watch */
  wallets: HotWallet[];
  /** How often to poll, in milliseconds (default: 60 000) */
  intervalMs?: number;
  /** Alert channel configuration */
  alertChannels?: AlertChannelConfig;
  /** Redis key TTL for de-duplication, in seconds (default: 1800) */
  alertCooldownSeconds?: number;
  /** SMTP-backed alert email delivery */
  alertEmailService?: AlertEmailService;
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

const lowBalanceAlertsCounter = new Counter({
  name: 'hot_wallet_low_balance_alerts_total',
  help: 'Total number of hot wallet low-balance alerts dispatched',
  labelNames: ['wallet_label', 'asset_code'],
  registers: [metricsService.getRegistry()],
});

const slaBreachTransactionsGauge = new Gauge({
  name: 'sla_breach_transactions_count',
  help: 'Number of transactions stuck in PENDING_EXTERNAL for over 2 hours',
  registers: [metricsService.getRegistry()],
});

// ─── Service ──────────────────────────────────────────────────────────────────

export class HotWalletMonitorService {
  private static instance: HotWalletMonitorService;

  private config: HotWalletMonitorConfig;
  private readonly alertEmailService: AlertEmailService;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly COOLDOWN_KEY_PREFIX = 'hot_wallet_alert:';
  private readonly BREACH_KEY_PREFIX = 'hot_wallet_breach:';
  /** Balance must recover above this multiple of the threshold before an all-clear is sent. */
  private readonly RECOVERY_THRESHOLD_MULTIPLIER = 1.1;

  private constructor(config: HotWalletMonitorConfig) {
    this.config = {
      intervalMs: 60_000,
      alertCooldownSeconds: 1_800,
      alertChannels: {
        slackWebhookUrl: process.env.ALERT_SLACK_WEBHOOK_URL,
        emailRecipients: process.env.ALERT_EMAIL_RECIPIENTS,
        customWebhookUrl: process.env.ALERT_WEBHOOK_URL,
        notificationUserIds: process.env.ALERT_NOTIFICATION_USER_IDS,
      },
      alertEmailService: config.alertEmailService ?? new SmtpAlertEmailService(),
      ...config,
    };
    this.alertEmailService = this.config.alertEmailService!;
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

    await this.checkSlaBreaches();

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
      } else if (balance >= wallet.thresholdAmount * this.RECOVERY_THRESHOLD_MULTIPLIER) {
        await this.handleRecovery(snapshot);
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

/** Check for transactions stuck in PENDING_EXTERNAL for over 2 hours and alert ops. */
  private async checkSlaBreaches(): Promise<void> {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    let pendingTransactions;
    try {
      pendingTransactions = await prisma.transaction.findMany({
        where: {
          status: 'PENDING_EXTERNAL',
          createdAt: { lt: twoHoursAgo },
        },
        select: {
          id: true,
          userId: true,
          assetCode: true,
          amount: true,
          type: true,
          createdAt: true,
        },
      });
    } catch (error) {
      logger.error('[HotWalletMonitor] Failed to query SLA breach transactions', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    slaBreachTransactionsGauge.set(pendingTransactions.length);

    if (pendingTransactions.length > 0) {
      logger.warn('[HotWalletMonitor] SLA breach detected — pending transactions stuck over 2 hours', {
        count: pendingTransactions.length,
        transactionIds: pendingTransactions.map((tx: { id: string }) => tx.id),
      });

      await this.handleSlaBreachAlert(pendingTransactions);
    }
  }

  private async handleSlaBreachAlert(transactions: Array<{ id: string; userId: string; assetCode: string; amount: string; type: string; createdAt: Date }>): Promise<void> {
    const payload: AlertPayload = {
      walletLabel: 'SLA Breach Monitor',
      publicKey: '',
      assetCode: 'MULTI',
      currentBalance: 0,
      thresholdAmount: 0,
      checkedAt: new Date().toISOString(),
    };

    logger.error('[HotWalletMonitor] SLA BREACH ALERT', { alert: payload, transactionCount: transactions.length });

    const channels = this.config.alertChannels ?? {};
    await Promise.allSettled([
      channels.slackWebhookUrl
        ? this.sendSlaSlackAlert(channels.slackWebhookUrl, transactions, payload)
        : Promise.resolve(),
      channels.emailRecipients
        ? this.sendSlaEmailAlert(channels.emailRecipients, transactions, payload)
        : Promise.resolve(),
      channels.customWebhookUrl
        ? this.sendCustomWebhook(channels.customWebhookUrl, payload)
        : Promise.resolve(),
    ]);
  }

  private async sendSlaSlackAlert(webhookUrl: string, transactions: Array<{ id: string; userId: string; assetCode: string; amount: string; type: string; createdAt: Date }>, alert: AlertPayload): Promise<void> {
    const transactionList = transactions
      .map((tx) => `• ${tx.id} — ${tx.type} ${tx.amount} ${tx.assetCode} (pending since ${tx.createdAt.toISOString()})`)
      .join('\n');

    const message = {
      text: '🚨 *SLA Breach Alert — Stuck Pending Transactions*',
      attachments: [
        {
          color: 'warning',
          fields: [
            { title: 'Stuck Transactions', value: transactionList, short: false },
            { title: 'Count', value: String(transactions.length), short: true },
            { title: 'Threshold', value: '2 hours', short: true },
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

    logger.info('[HotWalletMonitor] SLA breach Slack alert sent', { count: transactions.length });
  }

  private async sendSlaEmailAlert(recipients: string, transactions: Array<{ id: string; userId: string; assetCode: string; amount: string; type: string; createdAt: Date }>, alert: AlertPayload): Promise<void> {
    const transactionList = transactions
      .map((tx) => `  - ${tx.id}: ${tx.type} ${tx.amount} ${tx.assetCode} (pending since ${tx.createdAt.toISOString()})`)
      .join('\n');

    const text = [
      'SLA Breach Alert — Stuck Pending Transactions',
      `Count: ${transactions.length}`,
      `Threshold: 2 hours in PENDING_EXTERNAL state`,
      'Affected transactions:',
      transactionList,
      `Detected At: ${alert.checkedAt}`,
    ].join('\n');

    const sent = await smtpService.sendMail({
      to: recipients.split(',').map((recipient) => recipient.trim()).filter(Boolean),
      subject: '[AnchorPoint] SLA Breach: Stuck Pending Transactions',
      text,
    });

    if (sent) {
      logger.info('[HotWalletMonitor] SLA breach email alert sent', { recipients });
    }
    await this.alertEmailService.sendHotWalletLowBalanceAlert(recipients, alert);
    logger.info('[HotWalletMonitor] SLA breach email alert dispatched', { recipients });
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
      this.sendNotification(
        `[AnchorPoint] Low balance on ${payload.walletLabel}: ${payload.currentBalance} ${payload.assetCode} ` +
          `(threshold ${payload.thresholdAmount}). Detected at ${payload.checkedAt}.`
      ),
    ]);

    lowBalanceAlertsCounter.inc({ wallet_label: payload.walletLabel, asset_code: payload.assetCode });

    // Mark as alerted — suppress duplicates for cooldown period, and remember
    // the breach so an all-clear can be sent once the balance recovers.
    await redis.set(cooldownKey, '1', 'EX', this.config.alertCooldownSeconds!);
    await redis.set(this.breachKey(snapshot.wallet), '1');
  }

  /** Send an all-clear once a previously alerted wallet recovers above 110% of its threshold. */
  private async handleRecovery(snapshot: WalletBalanceSnapshot): Promise<void> {
    const breachKey = this.breachKey(snapshot.wallet);
    const inBreach = await redis.get(breachKey);
    if (!inBreach) {
      return;
    }

    logger.info('[HotWalletMonitor] Balance recovered — sending all-clear', {
      wallet: snapshot.wallet.label,
      balance: snapshot.balance,
    });

    await this.sendNotification(
      `[AnchorPoint] All clear: ${snapshot.wallet.label} balance recovered to ${snapshot.balance} ` +
        `${snapshot.wallet.assetCode} (threshold ${snapshot.wallet.thresholdAmount}). Checked at ${snapshot.checkedAt}.`
    );

    await redis.del(breachKey);
    await redis.del(`${this.COOLDOWN_KEY_PREFIX}${snapshot.wallet.publicKey}:${snapshot.wallet.assetCode}`);
  }

  private breachKey(wallet: HotWallet): string {
    return `${this.BREACH_KEY_PREFIX}${wallet.publicKey}:${wallet.assetCode}`;
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
    const text = [
      'Hot Wallet Low Balance Alert',
      `Wallet: ${alert.walletLabel}`,
      `Asset: ${alert.assetCode}`,
      `Current Balance: ${alert.currentBalance}`,
      `Threshold: ${alert.thresholdAmount}`,
      `Public Key: ${alert.publicKey}`,
      `Detected At: ${alert.checkedAt}`,
    ].join('\n');

    const sent = await smtpService.sendMail({
      to: recipients.split(',').map((recipient) => recipient.trim()).filter(Boolean),
      subject: `[AnchorPoint] Low Balance: ${alert.walletLabel}`,
      text,
    });

    if (sent) {
      logger.info('[HotWalletMonitor] Email alert sent', { wallet: alert.walletLabel, recipients });
    }
    await this.alertEmailService.sendHotWalletLowBalanceAlert(recipients, alert);
    logger.info('[HotWalletMonitor] Email alert dispatched', { wallet: alert.walletLabel });
  }

  /** Dispatch a message to every configured user via the notification service. */
  private async sendNotification(message: string): Promise<void> {
    const userIds = (this.config.alertChannels?.notificationUserIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    await Promise.all(userIds.map((userId) => notificationService.notify(userId, message)));
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
  // XLM wallets without an explicit thresholdAmount fall back to
  // LOW_BALANCE_THRESHOLD_XLM (default: 100 XLM).
  const walletsRaw = process.env.HOT_WALLETS;
  const lowBalanceThresholdXlm = parseFloat(process.env.LOW_BALANCE_THRESHOLD_XLM ?? '100');
  const wallets: HotWallet[] = (walletsRaw ? (JSON.parse(walletsRaw) as HotWallet[]) : []).map((w) =>
    w.thresholdAmount === undefined && w.assetCode === 'XLM' && (!w.assetIssuer || w.assetIssuer === 'native')
      ? { ...w, thresholdAmount: lowBalanceThresholdXlm }
      : w
  );

  return HotWalletMonitorService.getInstance({
    wallets,
    intervalMs: parseInt(process.env.HOT_WALLET_CHECK_INTERVAL_MS ?? '60000', 10),
    alertCooldownSeconds: parseInt(process.env.HOT_WALLET_ALERT_COOLDOWN_SEC ?? '1800', 10),
    alertChannels: {
      slackWebhookUrl: process.env.ALERT_SLACK_WEBHOOK_URL,
      emailRecipients: process.env.ALERT_EMAIL_RECIPIENTS,
      customWebhookUrl: process.env.ALERT_WEBHOOK_URL,
      notificationUserIds: process.env.ALERT_NOTIFICATION_USER_IDS,
    },
  });
}

export const hotWalletMonitorService = createMonitorFromEnv();
export default hotWalletMonitorService;
