import { Request } from 'express';
import prisma from '../lib/prisma';
import logger from '../utils/logger';

/**
 * Actions captured in the admin configuration audit trail.
 */
export type AdminAuditAction =
  | 'CONFIG_UPDATE'
  | 'CONFIG_UI_UPDATE'
  | 'CONFIG_ROLLBACK'
  | 'ADMIN_NETWORK_SWITCH'
  | 'ADMIN_TRANSACTION_STATUS_UPDATE'
  | 'ADMIN_PASSWORD_RESET_CONFIRM'
  | 'ADMIN_TOML_CACHE_PURGE'
  | 'FEATURE_FLAG_CREATE'
  | 'FEATURE_FLAG_UPDATE'
  | 'FEATURE_FLAG_ENABLE'
  | 'FEATURE_FLAG_DISABLE'
  | 'FEATURE_FLAG_ROLLOUT_UPDATE'
  | 'FEATURE_FLAG_TARGET_USERS_ADD'
  | 'FEATURE_FLAG_TARGET_USERS_REMOVE'
  | 'FEATURE_FLAG_DELETE';

/**
 * Information about the administrator (or automated actor) responsible for a
 * privileged configuration change. Populated from the authenticated request
 * where available.
 */
export interface AuditActor {
  id?: string | null;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface RecordConfigChangeParams {
  action: AdminAuditAction;
  actor?: AuditActor;
  /** Identifier of the entity affected by this action (e.g. `transaction:42`). */
  targetEntity?: string | null;
  configVersion?: number | null;
  previousVersion?: number | null;
  /** Previous config object, used to compute a field-level diff. */
  before?: Record<string, unknown> | null;
  /** New config object, used to compute a field-level diff. */
  after?: Record<string, unknown> | null;
  /** Arbitrary extra context to persist alongside the entry. */
  metadata?: Record<string, unknown> | null;
}

export interface AuditLogQuery {
  action?: AdminAuditAction;
  actorId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Derives the acting administrator from the request. Falls back gracefully
 * when the request has not been augmented with an authenticated identity.
 */
export function getAuditActor(req: Request): AuditActor {
  const authed = req as Request & {
    admin?: { id?: string; email?: string };
    user?: { id?: string; email?: string; publicKey?: string };
    apiKey?: { id?: string; label?: string };
  };

  const identity = authed.admin ?? authed.user;
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(',')[0]?.trim() || req.ip;

  return {
    id: identity?.id ?? (identity as any)?.publicKey ?? authed.apiKey?.id ?? null,
    email: identity?.email ?? authed.apiKey?.label ?? null,
    ip: ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

type FieldDiff = Record<string, { before: unknown; after: unknown }>;

/**
 * Computes a shallow, top-level diff between two configuration objects.
 * Returns the changed keys and a `{ before, after }` map for each of them.
 */
export function computeConfigDiff(
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null
): { changedKeys: string[]; diff: FieldDiff } {
  const diff: FieldDiff = {};

  if (!before && !after) {
    return { changedKeys: [], diff };
  }

  const keys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);

  for (const key of keys) {
    const prevValue = before?.[key];
    const nextValue = after?.[key];

    // Compare by structural equality; JSON stringify is sufficient for the
    // plain-object configuration payloads handled here.
    if (JSON.stringify(prevValue) !== JSON.stringify(nextValue)) {
      diff[key] = { before: prevValue, after: nextValue };
    }
  }

  return { changedKeys: Object.keys(diff), diff };
}

/**
 * Records and queries the admin configuration audit trail.
 *
 * Recording is intentionally best-effort: an audit write must never block or
 * fail the underlying configuration change, so failures are logged and
 * swallowed rather than propagated.
 */
export class AdminAuditService {
  async recordConfigChange(params: RecordConfigChangeParams): Promise<void> {
    try {
      const { changedKeys, diff } = computeConfigDiff(params.before, params.after);
      const metadata = params.targetEntity
        ? { targetEntity: params.targetEntity, ...params.metadata }
        : params.metadata;

      await prisma.adminConfigAuditLog.create({
        data: {
          action: params.action,
          actorId: params.actor?.id ?? null,
          actorEmail: params.actor?.email ?? null,
          actorIp: params.actor?.ip ?? null,
          userAgent: params.actor?.userAgent ?? null,
          configVersion: params.configVersion ?? null,
          previousVersion: params.previousVersion ?? null,
          changedKeys: changedKeys.length > 0 ? JSON.stringify(changedKeys) : null,
          diff: Object.keys(diff).length > 0 ? JSON.stringify(diff) : null,
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });

      logger.info('Recorded admin config audit entry', {
        action: params.action,
        actorId: params.actor?.id ?? undefined,
        configVersion: params.configVersion ?? undefined,
        changedKeys,
      });
    } catch (error) {
      // Never let auditing break the primary operation.
      logger.error('Failed to record admin config audit entry', {
        action: params.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async listAuditLogs(query: AuditLogQuery = {}) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);

    const where: Record<string, unknown> = {};
    if (query.action) {
      where.action = query.action;
    }
    if (query.actorId) {
      where.actorId = query.actorId;
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: query.startDate } : {}),
        ...(query.endDate ? { lte: query.endDate } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      prisma.adminConfigAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.adminConfigAuditLog.count({ where }),
    ]);

    const entries = rows.map((row) => ({
      ...row,
      changedKeys: safeJsonParse(row.changedKeys),
      diff: safeJsonParse(row.diff),
      metadata: safeJsonParse(row.metadata),
    }));

    return { entries, total, limit, offset };
  }
}

function safeJsonParse(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export const adminAuditService = new AdminAuditService();
export default adminAuditService;
