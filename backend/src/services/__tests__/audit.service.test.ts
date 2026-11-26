import { AuditService, AuditAction, AuditLogEntry } from '../audit.service';

// Mock dependencies
jest.mock('../../lib/prisma', () => ({
  adminAuditLog: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import prisma from '../../lib/prisma';

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditService();
  });

  describe('log', () => {
    it('should create an audit log entry with hash chain', async () => {
      const mockEntry: AuditLogEntry = {
        actorId: 'admin-123',
        actorEmail: 'admin@example.com',
        action: AuditAction.KYC_STATUS_OVERRIDE,
        resource: 'KycCustomer',
        resourceId: 'user-456',
        beforeState: { status: 'PENDING' },
        afterState: { status: 'ACCEPTED' },
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      };

      // Mock: no previous record
      (prisma.adminAuditLog.findFirst as jest.Mock).mockResolvedValue(null);
      
      // Mock: create record
      (prisma.adminAuditLog.create as jest.Mock).mockResolvedValue({
        id: 'audit-789',
        actorId: 'admin-123',
        actorEmail: 'admin@example.com',
        action: AuditAction.KYC_STATUS_OVERRIDE,
        resource: 'KycCustomer',
        resourceId: 'user-456',
        beforeState: { status: 'PENDING' },
        afterState: { status: 'ACCEPTED' },
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        timestamp: new Date(),
        hash: 'abc123hash',
        previousHash: null,
      });

      const result = await service.log(mockEntry);

      expect(result).toHaveProperty('hash');
      expect(result.actorId).toBe('admin-123');
      expect(result.action).toBe(AuditAction.KYC_STATUS_OVERRIDE);
      expect(prisma.adminAuditLog.create).toHaveBeenCalled();
    });

    it('should chain hash with previous record', async () => {
      const mockEntry: AuditLogEntry = {
        actorId: 'admin-123',
        action: AuditAction.FEE_SCHEDULE_UPDATE,
        resource: 'FeeSchedule',
        resourceId: 'fee-001',
        beforeState: { feeType: 'flat', feeFixed: 1.0 },
        afterState: { feeType: 'flat', feeFixed: 1.5 },
        ipAddress: '10.0.0.1',
      };

      // Mock: previous record exists
      (prisma.adminAuditLog.findFirst as jest.Mock).mockResolvedValue({
        hash: 'prevhash456',
      });

      (prisma.adminAuditLog.create as jest.Mock).mockResolvedValue({
        id: 'audit-790',
        actorId: 'admin-123',
        actorEmail: null,
        action: AuditAction.FEE_SCHEDULE_UPDATE,
        resource: 'FeeSchedule',
        resourceId: 'fee-001',
        beforeState: { feeType: 'flat', feeFixed: 1.0 },
        afterState: { feeType: 'flat', feeFixed: 1.5 },
        ipAddress: '10.0.0.1',
        userAgent: null,
        timestamp: new Date(),
        hash: 'newhash789',
        previousHash: 'prevhash456',
      });

      const result = await service.log(mockEntry);

      expect(result.previousHash).toBe('prevhash456');
    });
  });

  describe('logKycStatusOverride', () => {
    it('should log KYC status override with correct action', async () => {
      (prisma.adminAuditLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.adminAuditLog.create as jest.Mock).mockResolvedValue({
        id: 'audit-001',
        actorId: 'admin-1',
        actorEmail: 'admin@test.com',
        action: AuditAction.KYC_STATUS_OVERRIDE,
        resource: 'KycCustomer',
        resourceId: 'user-123',
        beforeState: { status: 'PENDING' },
        afterState: { status: 'ACCEPTED' },
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent',
        timestamp: new Date(),
        hash: 'hash1',
        previousHash: null,
      });

      const result = await service.logKycStatusOverride(
        'admin-1',
        'admin@test.com',
        'user-123',
        'PENDING',
        'ACCEPTED',
        '127.0.0.1',
        'TestAgent'
      );

      expect(result.action).toBe(AuditAction.KYC_STATUS_OVERRIDE);
      expect(result.beforeState).toEqual({ status: 'PENDING' });
      expect(result.afterState).toEqual({ status: 'ACCEPTED' });
    });
  });

  describe('logFeeScheduleUpdate', () => {
    it('should log fee schedule create action', async () => {
      (prisma.adminAuditLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.adminAuditLog.create as jest.Mock).mockResolvedValue({
        id: 'audit-002',
        actorId: 'admin-1',
        action: AuditAction.FEE_SCHEDULE_CREATE,
        resource: 'FeeSchedule',
        resourceId: 'fee-999',
        beforeState: null,
        afterState: { assetCode: 'USDC', feeType: 'percentage', feePercent: 0.5 },
        ipAddress: null,
        userAgent: null,
        timestamp: new Date(),
        hash: 'hash2',
        previousHash: null,
      });

      const result = await service.logFeeScheduleUpdate(
        'admin-1',
        'admin@test.com',
        'fee-999',
        'USDC',
        undefined,
        { assetCode: 'USDC', feeType: 'percentage', feePercent: 0.5 }
      );

      expect(result.action).toBe(AuditAction.FEE_SCHEDULE_CREATE);
    });

    it('should log fee schedule update action when beforeState exists', async () => {
      (prisma.adminAuditLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.adminAuditLog.create as jest.Mock).mockResolvedValue({
        id: 'audit-003',
        action: AuditAction.FEE_SCHEDULE_UPDATE,
      });

      const result = await service.logFeeScheduleUpdate(
        'admin-1',
        'admin@test.com',
        'fee-999',
        'USDC',
        { feeType: 'flat', feeFixed: 1.0 },
        { feeType: 'flat', feeFixed: 1.5 }
      );

      expect(result.action).toBe(AuditAction.FEE_SCHEDULE_UPDATE);
    });
  });

  describe('logRelayerAllowanceUpdate', () => {
    it('should log relayer allowance changes', async () => {
      (prisma.adminAuditLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.adminAuditLog.create as jest.Mock).mockResolvedValue({
        id: 'audit-004',
        action: AuditAction.RELAYER_ALLOWANCE_UPDATE,
        resource: 'Relayer',
        resourceId: 'relayer-001',
        beforeState: { allowance: '1000' },
        afterState: { allowance: '2000' },
      });

      const result = await service.logRelayerAllowanceUpdate(
        'admin-1',
        'admin@test.com',
        'relayer-001',
        '1000',
        '2000'
      );

      expect(result.action).toBe(AuditAction.RELAYER_ALLOWANCE_UPDATE);
      expect(result.beforeState).toEqual({ allowance: '1000' });
      expect(result.afterState).toEqual({ allowance: '2000' });
    });
  });

  describe('logPauseAction', () => {
    it('should log deposit pause action', async () => {
      (prisma.adminAuditLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.adminAuditLog.create as jest.Mock).mockResolvedValue({
        id: 'audit-005',
        action: AuditAction.PAUSE_DEPOSITS,
        afterState: { paused: true, reason: 'Maintenance' },
      });

      const result = await service.logPauseAction(
        'admin-1',
        'admin@test.com',
        'deposits',
        true,
        'Maintenance'
      );

      expect(result.action).toBe(AuditAction.PAUSE_DEPOSITS);
    });

    it('should log deposit resume action', async () => {
      (prisma.adminAuditLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.adminAuditLog.create as jest.Mock).mockResolvedValue({
        id: 'audit-006',
        action: AuditAction.RESUME_DEPOSITS,
        afterState: { paused: false },
      });

      const result = await service.logPauseAction(
        'admin-1',
        'admin@test.com',
        'deposits',
        false
      );

      expect(result.action).toBe(AuditAction.RESUME_DEPOSITS);
    });
  });

  describe('verifyIntegrity', () => {
    it('should return valid for empty records', async () => {
      (prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.verifyIntegrity();

      expect(result.isValid).toBe(true);
      expect(result.details).toContain('No records');
    });

    it('should detect broken hash chain', async () => {
      const mockRecords = [
        { id: '1', hash: 'hash1', previousHash: null, timestamp: new Date('2024-01-01') },
        { id: '2', hash: 'hash2', previousHash: 'wronghash', timestamp: new Date('2024-01-02') },
      ];

      (prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue(mockRecords);

      const result = await service.verifyIntegrity();

      expect(result.isValid).toBe(false);
      expect(result.brokenAt).toBeDefined();
    });

    it('should validate intact hash chain', async () => {
      const mockRecords = [
        { id: '1', hash: 'hash1', previousHash: null, timestamp: new Date('2024-01-01') },
        { id: '2', hash: 'hash2', previousHash: 'hash1', timestamp: new Date('2024-01-02') },
        { id: '3', hash: 'hash3', previousHash: 'hash2', timestamp: new Date('2024-01-03') },
      ];

      (prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue(mockRecords);

      const result = await service.verifyIntegrity();

      expect(result.isValid).toBe(true);
      expect(result.details).toContain('intact');
    });
  });

  describe('getAuditLogsForResource', () => {
    it('should retrieve audit logs for a resource', async () => {
      const mockRecords = [
        { id: '1', actorId: 'admin-1', action: AuditAction.KYC_STATUS_OVERRIDE, resource: 'KycCustomer', resourceId: 'user-1', timestamp: new Date() },
      ];

      (prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue(mockRecords);

      const result = await service.getAuditLogsForResource('KycCustomer', 'user-1');

      expect(result.length).toBe(1);
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resource: 'KycCustomer',
            resourceId: 'user-1',
          }),
        })
      );
    });
  });

  describe('getAuditLogsByActor', () => {
    it('should retrieve audit logs by actor', async () => {
      const mockRecords = [
        { id: '1', actorId: 'admin-1', action: AuditAction.KYC_STATUS_OVERRIDE, timestamp: new Date() },
      ];

      (prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue(mockRecords);

      const result = await service.getAuditLogsByActor('admin-1');

      expect(result.length).toBe(1);
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { actorId: 'admin-1' },
        })
      );
    });
  });
});

describe('AuditAction enum', () => {
  it('should have all required action types', () => {
    expect(AuditAction.KYC_STATUS_OVERRIDE).toBe('KYC_STATUS_OVERRIDE');
    expect(AuditAction.FEE_SCHEDULE_UPDATE).toBe('FEE_SCHEDULE_UPDATE');
    expect(AuditAction.RELAYER_ALLOWANCE_UPDATE).toBe('RELAYER_ALLOWANCE_UPDATE');
    expect(AuditAction.PAUSE_DEPOSITS).toBe('PAUSE_DEPOSITS');
    expect(AuditAction.RESUME_DEPOSITS).toBe('RESUME_DEPOSITS');
    expect(AuditAction.PAUSE_WITHDRAWALS).toBe('PAUSE_WITHDRAWALS');
    expect(AuditAction.RESUME_WITHDRAWALS).toBe('RESUME_WITHDRAWALS');
  });
});