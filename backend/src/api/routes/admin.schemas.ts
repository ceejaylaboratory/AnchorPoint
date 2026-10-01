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
