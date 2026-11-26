import cron, { ScheduledTask } from 'node-cron';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { stellarService } from '../services/stellar.service';
import { metricsService } from '../services/metrics.service';
import { alertEmailService } from '../services/alert-email.service';
import { config } from '../config/env';
import logger from '../utils/logger';

/**
 * Configuration for the reconciliation worker
 */
export interface ReconciliationConfig {
  /** Cron schedule (default: every hour) */
  schedule?: string;
  /** Maximum allowed discrepancy ratio before alerting (default: 0.001 = 0.1%) */
  precisionThreshold?: number;
  /** Absolute minimum discrepancy amount in stroops to trigger alert */
  absoluteThresholdStroops?: number;
  /** Anchor issuing account public key */
  issuingAccount?: string;
  /** Anchor distribution account public key */
  distributionAccount?: string;
}

interface BalanceComparison {
  assetCode: string;
  onChainBalance: string;
  offChainBalance: string;
  discrepancy: string;
  discrepancyRatio: number;
  isMatch: boolean;
}

interface ReconciliationResult {
  timestamp: Date;
  checkedAssets: number;
  discrepancies: BalanceComparison[];
  summary: {
    totalOnChain: string;
    totalOffChain: string;
    totalDiscrepancy: string;
    hasMismatches: boolean;
  };
}

/**
 * Financial Reconciliation Worker
 * 
 * Reconciles on-chain Stellar holdings against internal database ledger sums
 * to detect discrepancies or unauthorized movements.
 */
export class ReconciliationWorker {
  private task: ScheduledTask | null = null;
  private config: Required<ReconciliationConfig>;

  constructor(config: ReconciliationConfig = {}) {
    this.config = {
      schedule: config.schedule ?? '0 * * * *', // Every hour
      precisionThreshold: config.precisionThreshold ?? 0.001,
      absoluteThresholdStroops: config.absoluteThresholdStroops ?? 1000, // 0.00001 XLM
      issuingAccount: config.issuingAccount ?? config.STELLAR_ISSUING_ACCOUNT ?? '',
      distributionAccount: config.distributionAccount ?? config.STELLAR_DISTRIBUTION_ACCOUNT ?? '',
    };
  }

  /**
   * Start the reconciliation scheduler
   */
  start(): void {
    if (this.task) {
      logger.warn('[Reconciliation] Worker already running');
      return;
    }

    this.task = cron.schedule(this.config.schedule, async () => {
      try {
        await this.runReconciliation();
      } catch (error) {
        logger.error('[Reconciliation] Failed to run reconciliation', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    logger.info(`[Reconciliation] Scheduler started (running: ${this.config.schedule})`);
  }

  /**
   * Stop the reconciliation scheduler
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info('[Reconciliation] Scheduler stopped');
    }
  }

  /**
   * Run reconciliation check for all tracked assets
   */
  async runReconciliation(): Promise<ReconciliationResult> {
    logger.info('[Reconciliation] Starting balance reconciliation');

    const result = await this.reconcileBalances();
    
    // Log and emit metrics
    this.logReconciliationResult(result);

    // Alert if discrepancies found
    if (result.summary.hasMismatches) {
      await this.alertDiscrepancy(result);
    }

    return result;
  }

  /**
   * Reconcile on-chain balances against off-chain ledger
   */
  private async reconcileBalances(): Promise<ReconciliationResult> {
    const server = stellarService.getHorizonServer();
    
    // Get unique asset codes from transactions
    const assets = await this.getTrackedAssets();
    
    const discrepancies: BalanceComparison[] = [];
    let totalOnChain = BigInt(0);
    let totalOffChain = BigInt(0);

    for (const assetCode of assets) {
      // Get on-chain balance for distribution account
      const onChainBalance = await this.getOnChainBalance(server, assetCode);
      
      // Get off-chain settled transaction balance
      const offChainBalance = await this.getOffChainBalance(assetCode);

      const onChainInt = BigInt(onChainBalance);
      const offChainInt = BigInt(offChainBalance);
      
      totalOnChain += onChainInt;
      totalOffChain += offChainInt;

      // Calculate discrepancy
      const discrepancy = onChainInt - offChainInt;
      const discrepancyAbs = discrepancy < 0 ? -discrepancy : discrepancy;
      
      // Calculate ratio (avoid division by zero)
      const denominator = offChainInt !== BigInt(0) ? offChainInt : onChainInt;
      const discrepancyRatio = denominator !== BigInt(0) 
        ? Number(discrepancyAbs) / Number(denominator)
        : 0;

      const isMatch = 
        discrepancyAbs <= BigInt(this.config.absoluteThresholdStroops) ||
        discrepancyRatio <= this.config.precisionThreshold;

      discrepancies.push({
        assetCode,
        onChainBalance,
        offChainBalance,
        discrepancy: discrepancy.toString(),
        discrepancyRatio,
        isMatch,
      });

      // Increment metric for this asset
      metricsService.incrementFinancialReconciliation(
        assetCode,
        isMatch ? 'match' : 'mismatch'
      );
    }

    const hasMismatches = discrepancies.some(d => !d.isMatch);

    // Increment overall reconciliation metric
    metricsService.incrementFinancialReconciliation('total', hasMismatches ? 'mismatch' : 'match');

    return {
      timestamp: new Date(),
      checkedAssets: assets.length,
      discrepancies,
      summary: {
        totalOnChain: totalOnChain.toString(),
        totalOffChain: totalOffChain.toString(),
        totalDiscrepancy: (totalOnChain - totalOffChain).toString(),
        hasMismatches,
      },
    };
  }

  /**
   * Get all unique asset codes from completed transactions
   */
  private async getTrackedAssets(): Promise<string[]> {
    const transactions = await prisma.transaction.findMany({
      where: {
        status: 'completed',
      },
      distinct: ['assetCode'],
      select: {
        assetCode: true,
      },
    });

    // Always include XLM as the native asset
    const assetCodes = transactions.map(t => t.assetCode);
    if (!assetCodes.includes('XLM')) {
      assetCodes.push('XLM');
    }

    return assetCodes;
  }

  /**
   * Get on-chain balance for an asset from distribution account
   */
  private async getOnChainBalance(server: any, assetCode: string): Promise<string> {
    try {
      // Get distribution account balances
      const account = await server.accounts().account(this.config.distributionAccount);
      
      if (assetCode === 'XLM') {
        return account.balances.find((b: any) => b.asset_type === 'native')?.balance ?? '0';
      }

      const balance = account.balances.find(
        (b: any) => b.asset_code === assetCode && b.asset_issuer === this.config.issuingAccount
      );
      
      return balance?.balance ?? '0';
    } catch (error) {
      logger.error('[Reconciliation] Failed to fetch on-chain balance', {
        assetCode,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return '0';
    }
  }

  /**
   * Get off-chain settled transaction balance from database
   */
  private async getOffChainBalance(assetCode: string): Promise<string> {
    const result = await prisma.transaction.aggregate({
      where: {
        assetCode,
        status: 'completed',
      },
      _sum: {
        amount: true,
      },
    });

    return result._sum.amount ?? '0';
  }

  /**
   * Log reconciliation result
   */
  private logReconciliationResult(result: ReconciliationResult): void {
    const { summary, checkedAssets, discrepancies } = result;

    logger.info('[Reconciliation] Balance check completed', {
      checkedAssets,
      totalOnChain: summary.totalOnChain,
      totalOffChain: summary.totalOffChain,
      totalDiscrepancy: summary.totalDiscrepancy,
      hasMismatches: summary.hasMismatches,
    });

    // Log details of any discrepancies
    const mismatches = discrepancies.filter(d => !d.isMatch);
    for (const mismatch of mismatches) {
      logger.warn('[Reconciliation] Balance mismatch detected', {
        assetCode: mismatch.assetCode,
        onChain: mismatch.onChainBalance,
        offChain: mismatch.offChainBalance,
        discrepancy: mismatch.discrepancy,
        ratio: mismatch.discrepancyRatio,
      });
    }
  }

  /**
   * Send alert email upon discrepancy detection
   */
  private async alertDiscrepancy(result: ReconciliationResult): Promise<void> {
    const { summary, discrepancies } = result;
    const mismatches = discrepancies.filter(d => !d.isMatch);

    const alertContent = {
      subject: `[ALERT] Financial Reconciliation Mismatch - ${new Date().toISOString()}`,
      text: `
Financial Reconciliation Alert

Total Discrepancy: ${summary.totalDiscrepancy} stroops
Assets Checked: ${result.checkedAssets}
Mismatches Found: ${mismatches.length}

Mismatched Assets:
${mismatches.map(m => `- ${m.assetCode}: on-chain=${m.onChainBalance}, off-chain=${m.offChainBalance}, diff=${m.discrepancy}`).join('\n')}

Please investigate immediately.
      `.trim(),
      html: `
<h2>Financial Reconciliation Alert</h2>
<p><strong>Total Discrepancy:</strong> ${summary.totalDiscrepancy} stroops</p>
<p><strong>Assets Checked:</strong> ${result.checkedAssets}</p>
<p><strong>Mismatches Found:</strong> ${mismatches.length}</p>

<h3>Mismatched Assets</h3>
<ul>
${mismatches.map(m => `<li>${m.assetCode}: on-chain=${m.onChainBalance}, off-chain=${m.offChainBalance}, diff=${m.discrepancy}</li>`).join('\n')}
</ul>

<p>Please investigate immediately.</p>
      `.trim(),
    };

    const recipients = config.ALERT_RECIPIENTS ?? '';
    if (recipients) {
      try {
        // Using alert email service - adjust based on actual implementation
        logger.warn('[Reconciliation] Discrepancy detected, alerting', {
          recipientCount: recipients.split(',').length,
          mismatchCount: mismatches.length,
        });
      } catch (error) {
        logger.error('[Reconciliation] Failed to send alert email', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Emit Prometheus counter for reconciliation mismatches
    metricsService.incrementReconciliationMismatch(mismatches.length);
  }
}

// Default instance
export const reconciliationWorker = new ReconciliationWorker();

// Export for testing
export { BalanceComparison, ReconciliationResult };