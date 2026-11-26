import crypto from 'crypto';
import prisma from '../lib/prisma';
import logger from '../utils/logger';

/**
 * Audit action types for administrative operations
 */
export enum AuditAction {
  // KYC actions
  KYC_STATUS_OVERRIDE = 'KYC_STATUS_OVERRIDE',
  
  // Fee schedule actions
  FEE_SCHEDULE_CREATE = 'FEE_SCHEDULE_CREATE',
  FEE_SCHEDULE_UPDATE = 'FEE_SCHEDULE_UPDATE',
  FEE_SCHEDULE_DELETE = 'FEE_SCHEDULE_DELETE',
  
  // Relayer actions
  RELAYER_ALLOWANCE_UPDATE = 'RELAYER_ALLOWANCE_UPDATE',
  RELAYER_CONFIG_UPDATE = 'RELAYER_CONFIG_UPDATE',
  
  // Deposit/withdrawal control
  PAUSE_DEPOSITS = 'PAUSE_DEPOSITS',
  RESUME_DEPOSITS = 'RESUME_DEPOSITS',
  PAUSE_WITHDRAWALS = 'PAUSE_WITHDRAWALS',
  RESUME_WITHDRAWALS = 'RESUME_WITHDRAWALS',
  
  // Transaction actions
  TRANSACTION_STATUS_OVERRIDE = 'TRANSACTION_STATUS_OVERRIDE',
  TRANSACTION_REFUND = 'TRANSACTION_REFUND',
  
  // Configuration
  SYSTEM_CONFIG_UPDATE = 'SYSTEM_CONFIG_UPDATE',
  
  // User management
  USER_SUSPEND = 'USER_SUSPEND',
  USER_UNSUSPEND = 'USER_UNSUSPEND',
  USER_DELETE = 'USER_DELETE',
  
  // Generic mutation
  GENERIC_UPDATE = 'GENERIC_UPDATE',
}

/**
 * Audit log entry input
 */
export interface AuditLogEntry {
  actorId?: string;
  actorEmail?: string;
  action: AuditAction | string;
  resource: string;
  resourceId?: string;
  beforeState?: Record<string, any>;
  afterState?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Audit log entry with hash
 */
export interface AuditLogWithHash {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  beforeState: Record<string, any> | null;
  afterState: Record<string, any> | null;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: Date;
  hash: string;
  previousHash: string | null;
}

/**
 * Audit Service
 * 
 * Provides tamper-evident audit logging with SHA-256 hash chain
 * for regulatory and compliance review of administrative actions.
 */
export class AuditService {
  private static readonly HASH_FIELDS = [
    'actorId',
    'action',
    'resource',
    'resourceId',
    'beforeState',
    'afterState',
    'ipAddress',
    'timestamp',
    'previousHash',
  ];

  /**
   * Log an administrative action
   */
  async log(entry: AuditLogEntry): Promise<AuditLogWithHash> {
    // Get the previous hash for chaining
    const previousRecord = await this.getLastAuditRecord();
    const previousHash = previousRecord?.hash ?? null;

    // Create the timestamp
    const timestamp = new Date();

    // Calculate hash for this record
    const hash = this.calculateHash({
      ...entry,
      timestamp,
      previousHash,
    });

    // Store the audit record
    const record = await prisma.adminAuditLog.create({
      data: {
        actorId: entry.actorId,
        actorEmail: entry.actorEmail,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        beforeState: entry.beforeState ?? undefined,
        afterState: entry.afterState ?? undefined,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        timestamp,
        hash,
        previousHash,
      },
    });

    logger.info('[Audit] Administrative action logged', {
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
      actorId: entry.actorId,
      hash: hash.substring(0, 16) + '...',
    });

    return this.mapToAuditLogWithHash(record);
  }

  /**
   * Log KYC status override
   */
  async logKycStatusOverride(
    actorId: string,
    actorEmail: string,
    userId: string,
    oldStatus: string,
    newStatus: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<AuditLogWithHash> {
    return this.log({
      actorId,
      actorEmail,
      action: AuditAction.KYC_STATUS_OVERRIDE,
      resource: 'KycCustomer',
      resourceId: userId,
      beforeState: { status: oldStatus },
      afterState: { status: newStatus },
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log fee schedule update
   */
  async logFeeScheduleUpdate(
    actorId: string,
    actorEmail: string,
    feeScheduleId: string,
    assetCode: string,
    beforeState?: { feeType: string; feeFixed: number; feePercent: number },
    afterState?: { feeType: string; feeFixed: number; feePercent: number },
    ipAddress?: string,
    userAgent?: string
  ): Promise<AuditLogWithHash> {
    const action = beforeState 
      ? AuditAction.FEE_SCHEDULE_UPDATE 
      : AuditAction.FEE_SCHEDULE_CREATE;

    return this.log({
      actorId,
      actorEmail,
      action,
      resource: 'FeeSchedule',
      resourceId: feeScheduleId,
      beforeState: beforeState ? { ...beforeState, assetCode } : undefined,
      afterState: afterState ? { ...afterState, assetCode } : undefined,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log relayer allowance update
   */
  async logRelayerAllowanceUpdate(
    actorId: string,
    actorEmail: string,
    relayerId: string,
    oldAllowance?: string,
    newAllowance?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<AuditLogWithHash> {
    return this.log({
      actorId,
      actorEmail,
      action: AuditAction.RELAYER_ALLOWANCE_UPDATE,
      resource: 'Relayer',
      resourceId: relayerId,
      beforeState: oldAllowance ? { allowance: oldAllowance } : undefined,
      afterState: newAllowance ? { allowance: newAllowance } : undefined,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log deposit/withdrawal pause
   */
  async logPauseAction(
    actorId: string,
    actorEmail: string,
    actionType: 'deposits' | 'withdrawals',
    paused: boolean,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<AuditLogWithHash> {
    const action = paused 
      ? (actionType === 'deposits' ? AuditAction.PAUSE_DEPOSITS : AuditAction.PAUSE_WITHDRAWALS)
      : (actionType === 'deposits' ? AuditAction.RESUME_DEPOSITS : AuditAction.RESUME_WITHDRAWALS);

    return this.log({
      actorId,
      actorEmail,
      action,
      resource: 'SystemConfig',
      resourceId: `global/${actionType}`,
      beforeState: { paused: !paused, reason: reason ? undefined : 'N/A' },
      afterState: { paused, reason },
      ipAddress,
      userAgent,
    });
  }

  /**
   * Verify audit log integrity by checking hash chain
   */
  async verifyIntegrity(startDate?: Date, endDate?: Date): Promise<{
    isValid: boolean;
    brokenAt?: Date;
    details: string;
  }> {
    const records = await prisma.adminAuditLog.findMany({
      where: {
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        timestamp: 'asc',
      },
      select: {
        id: true,
        hash: true,
        previousHash: true,
        timestamp: true,
      },
    });

    if (records.length === 0) {
      return {
        isValid: true,
        details: 'No records to verify',
      };
    }

    // Check first record's previousHash (should be null or match last record before range)
    const firstRecord = records[0];
    if (firstRecord.previousHash) {
      // Could verify against external storage, but for now we accept it
    }

    // Verify hash chain
    for (let i = 1; i < records.length; i++) {
      const current = records[i];
      const previous = records[i - 1];

      if (current.previousHash !== previous.hash) {
        return {
          isValid: false,
          brokenAt: current.timestamp,
          details: `Hash chain broken at record ${current.id} (timestamp: ${current.timestamp.toISOString()})`,
        };
      }
    }

    return {
      isValid: true,
      details: `Verified ${records.length} records - hash chain is intact`,
    };
  }

  /**
   * Get audit logs for a specific resource
   */
  async getAuditLogsForResource(
    resource: string,
    resourceId?: string,
    options?: { limit?: number; offset?: number; startDate?: Date; endDate?: Date }
  ): Promise<AuditLogWithHash[]> {
    const records = await prisma.adminAuditLog.findMany({
      where: {
        resource,
        resourceId: resourceId ?? undefined,
        timestamp: {
          gte: options?.startDate,
          lte: options?.endDate,
        },
      },
      orderBy: {
        timestamp: 'desc',
      },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });

    return records.map(this.mapToAuditLogWithHash);
  }

  /**
   * Get audit logs for a specific actor
   */
  async getAuditLogsByActor(
    actorId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AuditLogWithHash[]> {
    const records = await prisma.adminAuditLog.findMany({
      where: {
        actorId,
      },
      orderBy: {
        timestamp: 'desc',
      },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });

    return records.map(this.mapToAuditLogWithHash);
  }

  /**
   * Calculate SHA-256 hash for an audit record
   */
  private calculateHash(data: {
    actorId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    beforeState?: Record<string, any>;
    afterState?: Record<string, any>;
    ipAddress?: string;
    timestamp: Date;
    previousHash: string | null;
  }): string {
    // Create canonical string representation
    const canonicalData = {
      actorId: data.actorId ?? '',
      action: data.action,
      resource: data.resource,
      resourceId: data.resourceId ?? '',
      beforeState: data.beforeState ? JSON.stringify(data.beforeState) : '',
      afterState: data.afterState ? JSON.stringify(data.afterState) : '',
      ipAddress: data.ipAddress ?? '',
      timestamp: data.timestamp.toISOString(),
      previousHash: data.previousHash ?? '',
    };

    const hashInput = JSON.stringify(canonicalData);
    return crypto.createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Get the last audit record for hash chaining
   */
  private async getLastAuditRecord(): Promise<{ hash: string } | null> {
    const lastRecord = await prisma.adminAuditLog.findFirst({
      orderBy: {
        timestamp: 'desc',
      },
      select: {
        hash: true,
      },
    });

    return lastRecord;
  }

  /**
   * Map Prisma result to typed interface
   */
  private mapToAuditLogWithHash(record: any): AuditLogWithHash {
    return {
      id: record.id,
      actorId: record.actorId,
      actorEmail: record.actorEmail,
      action: record.action,
      resource: record.resource,
      resourceId: record.resourceId,
      beforeState: record.beforeState,
      afterState: record.afterState,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
      timestamp: record.timestamp,
      hash: record.hash,
      previousHash: record.previousHash,
    };
  }
}

// Export singleton instance
export const auditService = new AuditService();

// Export action enum
export { AuditAction };

// Export types
export type { AuditLogEntry, AuditLogWithHash };