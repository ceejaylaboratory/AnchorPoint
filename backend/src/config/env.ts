import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const inferredNodeEnv = process.env.NODE_ENV === 'test' ? 'test' : process.env.NODE_ENV;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .default('3002')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().positive()),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').default('file:./prisma/dev.db'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters').default('stellar-anchor-secret'),
  INTERACTIVE_URL: z.string().url().default('http://localhost:3000'),
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().min(1, 'WEBHOOK_SECRET cannot be empty').optional(),
  WEBHOOK_TIMEOUT_MS: z
    .string()
    .default('5000')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().positive()),
  WEBHOOK_MAX_RETRIES: z
    .string()
    .default('3')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(0).max(10)),
  WEBHOOK_RETRY_DELAY_MS: z
    .string()
    .default('500')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(0)),
  STELLAR_NETWORK: z.enum(['testnet', 'public']).default('testnet'),
  STELLAR_HORIZON_URL: z.string().url().default('https://horizon-testnet.stellar.org'),
  STELLAR_FEE_BUMP_SECRET: z.string().optional(),
  STELLAR_BASE_FEE: z.string().default('100'),
  // Key Management Configuration
  KEY_MANAGEMENT_BACKEND: z.enum(['aws-kms', 'vault']).default('aws-kms'),
  AWS_KMS_KEY_ARN: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  VAULT_ADDR: z.string().url().optional(),
  VAULT_TOKEN: z.string().optional(),
  VAULT_TRANSIT_PATH: z.string().optional(),
  SIGNING_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse({
  ...process.env,
  NODE_ENV: inferredNodeEnv,
});

if (!parsed.success) {
  console.error('Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
