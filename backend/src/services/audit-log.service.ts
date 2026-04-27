import prisma from '../lib/prisma';
import logger from '../utils/logger';

export interface CreateAuditLogParams {
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLogQuery {
  userId?: string;
  resourceType?: string;
  action?: string;
  page?: number;
  limit?: number;
}

export const createAuditLog = async (params: CreateAuditLogParams): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        before: params.before !== undefined ? (params.before as object) : undefined,
        after: params.after !== undefined ? (params.after as object) : undefined,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  } catch (error) {
    // Audit log failures must not break the main request
    logger.error('Failed to write audit log', { error, params });
  }
};

export const queryAuditLogs = async (query: AuditLogQuery) => {
  const { userId, resourceType, action, page = 1, limit = 20 } = query;
  const skip = (page - 1) * limit;

  const where = {
    ...(userId && { userId }),
    ...(resourceType && { resourceType }),
    ...(action && { action }),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};
