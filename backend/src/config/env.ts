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
  STELLAR_NETWORK: z.enum(['testnet', 'public', 'futurenet']).default('testnet'),
  STELLAR_HORIZON_URL: z.string().url().default('https://horizon-testnet.stellar.org'),
  HORIZON_URL: z.string().url().default('https://horizon-testnet.stellar.org'),
  STELLAR_NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),
  STELLAR_FEE_BUMP_SECRET: z.string().optional(),
  STELLAR_BASE_FEE: z.string().default('100'),
  RELAYER_PUBLIC_KEY: z.string().optional(),
  RELAYER_SECRET_KEY: z.string().optional(),
  RELAYER_MAX_AMOUNT: z.string().default('1000000'),
  RELAYER_ALLOWED_SPENDERS: z.string().optional(),
  RELAYER_EXPIRY_WINDOW: z
    .string()
    .default('3600')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(0)),
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
