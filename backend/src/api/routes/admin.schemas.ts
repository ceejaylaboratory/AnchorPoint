import { z } from 'zod';

/**
 * Zod validation schemas for admin API request payloads.
 *
 * These schemas enforce structural and type correctness at the route boundary
 * before requests reach controllers. They are also used by the Swagger
 * generation to produce accurate request-body documentation.
 */

export const switchNetworkSchema = z.object({
  network: z.enum(['testnet', 'mainnet'], {
    message: 'network must be "testnet" or "mainnet"',
  }),
});

export const patchTransactionSchema = z.object({
  status: z
    .string()
    .min(1, 'status is required')
    .optional(),
  memo: z.string().max(28, 'memo must be 28 characters or fewer').optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field (status or memo) must be provided' }
);

export const passwordResetRequestSchema = z.object({
  email: z.string().email('email must be a valid email address'),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1, 'token is required'),
  newPassword: z
    .string()
    .min(8, 'newPassword must be at least 8 characters')
    .max(128, 'newPassword must be at most 128 characters'),
});

export const purgeCacheSchema = z.object({
  cacheType: z
    .enum(['toml', 'all'], {
      message: 'cacheType must be "toml" or "all"',
    })
    .optional()
    .default('toml'),
});

export const createFeeScheduleSchema = z.object({
  assetCode: z.string().min(1, 'assetCode is required').transform((s) => s.toUpperCase()),
  feeType: z.enum(['flat', 'percentage', 'tiered'], {
    message: 'feeType must be flat, percentage, or tiered',
  }),
  feeFixed: z.coerce.number().min(0, 'feeFixed must be non-negative').default(0),
  feePercent: z.coerce.number().min(0, 'feePercent must be non-negative').default(0),
  feeMinimum: z.coerce.number().min(0, 'feeMinimum must be non-negative').default(0),
  effectiveFrom: z.string().optional(),
  effective_from: z.string().optional(),
}).refine(
  (data) => Boolean(data.effectiveFrom || data.effective_from),
  { message: 'effectiveFrom or effective_from is required', path: ['effectiveFrom'] }
).refine(
  (data) => {
    const raw = data.effectiveFrom || data.effective_from;
    const d = new Date(raw!);
    return !isNaN(d.getTime()) && d.getTime() > Date.now();
  },
  { message: 'effectiveFrom must be a future date', path: ['effectiveFrom'] }
);

export const adminMfaConfirmSchema = z.object({
  code: z
    .string()
    .min(6, 'TOTP code is required')
    .max(20, 'Invalid code format'),
});

export const adminLoginSchema = z.object({
  email: z.string().email('email must be a valid email address'),
  password: z.string().min(1, 'password is required'),
  totpCode: z.string().optional(),
  code: z.string().optional(),
  token: z.string().optional(),
  backupCode: z.string().optional(),
});
