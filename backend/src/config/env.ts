import { z } from 'zod';
import dotenv from 'dotenv';
import { validateSep38QuotesCacheConfig } from './sep38-quotes-cache.config';

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
  // PostgreSQL connection pool configuration for production high-concurrency workloads.
  // DATABASE_POOL_SIZE maps to Prisma's `connection_limit`.
  DATABASE_POOL_SIZE: z
    .string()
    .default('10')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(100)),
  // DATABASE_POOL_TIMEOUT_MS is the connection acquisition timeout (Prisma's `pool_timeout`).
  DATABASE_POOL_TIMEOUT_MS: z
    .string()
    .default('5000')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(1000).max(60000)),
  // SSL mode for PostgreSQL connections. Defaults to 'disable' for safe local
  // development. Set to 'require' (or stricter) for production deployments.
  DB_SSL_MODE: z.enum(['require', 'disable', 'allow', 'prefer', 'verify-ca', 'verify-full']).default('disable'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters').default('stellar-anchor-secret'),
  SEP24_INTERACTIVE_URL_JWT_SECRET: z
    .string()
    .min(8, 'SEP24_INTERACTIVE_URL_JWT_SECRET must be at least 8 characters')
    .optional(),
  SEP24_INTERACTIVE_URL_JWT_EXPIRATION_SECONDS: z
    .string()
    .default('600')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(60).max(86400)),
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
  RECURRING_PAYMENTS_WORKER_CRON: z.string().default('*/1 * * * *'),
  // Exponential backoff configuration for the recurring payments retry worker.
  // Max number of retry attempts for a single occurrence before giving up and
  // deferring to the next scheduled (cron) run.
  RECURRING_PAYMENTS_MAX_RETRIES: z
    .string()
    .default('5')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(0).max(20)),
  // Base delay (ms) for the first retry.
  RECURRING_PAYMENTS_BACKOFF_BASE_MS: z
    .string()
    .default('30000')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(0)),
  // Upper bound (ms) on any single backoff delay.
  RECURRING_PAYMENTS_BACKOFF_MAX_MS: z
    .string()
    .default('3600000')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(0)),
  // Multiplier applied per attempt (delay = base * multiplier^(attempt-1)).
  RECURRING_PAYMENTS_BACKOFF_MULTIPLIER: z
    .string()
    .default('2')
    .transform((val: string) => parseFloat(val))
    .pipe(z.number().min(1)),
  // Fractional jitter (0..1) applied to each delay to avoid thundering herds.
  RECURRING_PAYMENTS_BACKOFF_JITTER: z
    .string()
    .default('0.2')
    .transform((val: string) => parseFloat(val))
    .pipe(z.number().min(0).max(1)),
  STELLAR_NETWORK_PASSPHRASE: z
    .string()
    .default('Test SDF Network ; September 2015'),
  STELLAR_HORIZON_URL: z.string().url().default('https://horizon-testnet.stellar.org'),
  HORIZON_URL: z.string().url().default('https://horizon-testnet.stellar.org'),
  STELLAR_RPC_URLS: z.string().optional(),
  STELLAR_FEE_BUMP_SECRET: z.string().optional(),
  STELLAR_DISTRIBUTION_SECRET: z.string().optional(),
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
  ENABLE_KEY_ROTATION_WORKER: z.enum(['true', 'false']).default('false'),
  KEY_ROTATION_WORKER_CRON: z.string().default('0 0 1 * *'),
  KYC_PROVIDER: z.enum(['mock', 'persona', 'shufti']).default('mock'),
  KYC_WEBHOOK_SECRET: z.string().optional(),
  PERSONA_API_KEY: z.string().optional(),
  PERSONA_API_URL: z.string().url().default('https://withpersona.com/api/v1'),
  SHUFTI_CLIENT_ID: z.string().optional(),
  SHUFTI_SECRET_KEY: z.string().optional(),
  SHUFTI_API_URL: z.string().url().default('https://api.shuftipro.com'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .pipe(z.number().int().positive().optional()),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),
  ADMIN_PASSWORD_RESET_URL_BASE: z.string().url().default('http://localhost:3000/admin/reset-password'),
  PASSWORD_RESET_TTL_MINUTES: z
    .string()
    .default('15')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(5).max(60)),
  ANCHOR_PUBLIC_KEY: z.string().optional(), // For SEP-10 challenges
  ANCHOR_SECRET_KEY: z.string().optional(), // For SEP-10 challenges
  REGISTRY_CONTRACT_ID: z.string().optional(), // Registry contract address
  // SEP-40 oracle (price feed) contract address consumed by the price feed
  // subscription manager.
  SEP40_ORACLE_CONTRACT_ID: z.string().optional(),
  // Default polling interval (ms) for SEP-40 price feed subscriptions.
  SEP40_POLL_INTERVAL_MS: z
    .string()
    .default('60000')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(1000)),
  // Maximum age (ms) of an on-chain price before it is considered stale.
  SEP40_MAX_PRICE_AGE_MS: z
    .string()
    .default('300000')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(0)),
  SEP12_MAX_FILE_SIZE_MB: z
    .string()
    .default('20')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  SEP38_INDICATIVE_QUOTE_EXPIRATION_SECONDS: z
    .string()
    .default('60')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(15).max(300)),
  SEP38_FIRM_QUOTE_VALIDITY_SECONDS: z
    .string()
    .default('300')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(60).max(3600)),
  SEP38_QUOTE_CACHE_TTL_SECONDS: z
    .string()
    .default('30')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(5).max(300)),
  SEP38_QUOTE_CACHE_STALE_TTL_SECONDS: z
    .string()
    .default('30')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(0).max(300)),
  SEP38_ASSETS_CACHE_TTL_SECONDS: z
    .string()
    .default('3600')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(60).max(86400)),
  UPLOAD_URL_EXPIRY_SECONDS: z
    .string()
    .default('900')
    .transform((val: string) => parseInt(val, 10))
    .pipe(z.number().int().min(60).max(86400)),
}).superRefine((data, ctx) => {
  if (
    !validateSep38QuotesCacheConfig({
      indicativeQuoteExpirationSeconds: data.SEP38_INDICATIVE_QUOTE_EXPIRATION_SECONDS,
      firmQuoteValiditySeconds: data.SEP38_FIRM_QUOTE_VALIDITY_SECONDS,
      quoteCacheTtlSeconds: data.SEP38_QUOTE_CACHE_TTL_SECONDS,
      quoteCacheStaleTtlSeconds: data.SEP38_QUOTE_CACHE_STALE_TTL_SECONDS,
      assetsCacheTtlSeconds: data.SEP38_ASSETS_CACHE_TTL_SECONDS,
    })
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid SEP-38 quotes cache timeout settings',
      path: ['SEP38_QUOTE_CACHE_TTL_SECONDS'],
    });
  }
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

const SENSITIVE_CONFIG_KEYS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ANCHOR_SECRET_KEY',
  'STELLAR_DISTRIBUTION_SECRET',
  'STELLAR_FEE_BUMP_SECRET',
  'RELAYER_SECRET_KEY',
  'WEBHOOK_SECRET',
  'SIGNING_KEY',
] as const;

/**
 * Decrypt KMS/Vault-prefixed sensitive env values onto the live config object.
 * Falls back to local plaintext in development when KMS is unavailable.
 * Call once during application startup (before serving traffic).
 */
export async function hydrateEncryptedConfigSecrets(): Promise<void> {
  // Lazy import avoids circular dependency at module load time
  const {
    resolveSensitiveEnvSecrets,
    buildKeyManagementConfigFromEnv,
    initializeKeyManagement,
  } = await import('../lib/key-management.service');

  const kmConfig = buildKeyManagementConfigFromEnv({
    KEY_MANAGEMENT_BACKEND: config.KEY_MANAGEMENT_BACKEND,
    AWS_KMS_KEY_ARN: config.AWS_KMS_KEY_ARN,
    AWS_REGION: config.AWS_REGION,
    AWS_ACCESS_KEY_ID: config.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: config.AWS_SECRET_ACCESS_KEY,
    VAULT_ADDR: config.VAULT_ADDR,
    VAULT_TOKEN: config.VAULT_TOKEN,
    VAULT_TRANSIT_PATH: config.VAULT_TRANSIT_PATH,
  });

  if (kmConfig) {
    try {
      initializeKeyManagement(kmConfig);
    } catch {
      // Initialization failures are handled by decrypt fallbacks / startup checks
    }
  }

  const current: Record<string, string | undefined> = {};
  for (const key of SENSITIVE_CONFIG_KEYS) {
    current[key] = (config as Record<string, unknown>)[key] as string | undefined;
  }

  const resolved = await resolveSensitiveEnvSecrets(current, [...SENSITIVE_CONFIG_KEYS]);

  for (const key of SENSITIVE_CONFIG_KEYS) {
    if (resolved[key] !== undefined) {
      (config as Record<string, unknown>)[key] = resolved[key];
      process.env[key] = resolved[key];
    }
  }
}

const uiFieldRequirementSchema = z.object({
  key: z.string().min(1, 'Field key is required'),
  label: z.string().min(1, 'Field label is required'),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
});

const dashboardUiSchema = z.object({
  brandName: z.string().min(1).default('AnchorPoint'),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().regex(/^#([0-9a-fA-F]{6})$/, 'Primary color must be a hex value').default('#3b82f6'),
  accentColor: z.string().regex(/^#([0-9a-fA-F]{6})$/, 'Accent color must be a hex value').default('#14b8a6'),
  supportEmail: z.string().email().optional(),
  bannerMessage: z.string().optional(),
  fieldRequirements: z.object({
    deposit: z.array(uiFieldRequirementSchema).default([]),
    withdraw: z.array(uiFieldRequirementSchema).default([]),
    kyc: z.array(uiFieldRequirementSchema).default([]),
  }).default({
    deposit: [],
    withdraw: [],
    kyc: [],
  }),
});

const sep31AssetConfigSchema = z.object({
  enabled: z.boolean(),
  min_amount: z.number().positive(),
  max_amount: z.number().positive(),
  fee_fixed: z.number().min(0),
  fee_percent: z.number().min(0),
  quotes_supported: z.boolean().default(false),
  quotes_required: z.boolean().default(false),
  sender_sep12_type: z.string().default('sep31-sender'),
  receiver_sep12_type: z.string().default('sep31-receiver'),
});

const sep31ConfigSchema = z.object({
  assets: z.record(z.string(), sep31AssetConfigSchema),
});

export const dynamicConfigSchema = z.object({
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters'),
  INTERACTIVE_URL: z.string().url(),
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().min(1, 'WEBHOOK_SECRET cannot be empty').optional(),
  WEBHOOK_TIMEOUT_MS: z.number().positive(),
  WEBHOOK_MAX_RETRIES: z.number().int().min(0).max(10),
  WEBHOOK_RETRY_DELAY_MS: z.number().int().min(0),
  STELLAR_NETWORK: z.enum(['testnet', 'public']).default('testnet'),
  STELLAR_HORIZON_URL: z.string().url(),
  STELLAR_FEE_BUMP_SECRET: z.string().optional(),
  STELLAR_BASE_FEE: z.string(),
  sep31: sep31ConfigSchema.default({
    assets: {
      USDC: {
        enabled: true,
        min_amount: 1,
        max_amount: 1_000_000,
        fee_fixed: 0,
        fee_percent: 0.5,
        quotes_supported: false,
        quotes_required: false,
        sender_sep12_type: 'sep31-sender',
        receiver_sep12_type: 'sep31-receiver',
      },
      EURC: {
        enabled: true,
        min_amount: 1,
        max_amount: 1_000_000,
        fee_fixed: 0,
        fee_percent: 0.5,
        quotes_supported: false,
        quotes_required: false,
        sender_sep12_type: 'sep31-sender',
        receiver_sep12_type: 'sep31-receiver',
      },
    },
  }),
  ui: dashboardUiSchema.default({
    brandName: 'AnchorPoint',
    primaryColor: '#3b82f6',
    accentColor: '#14b8a6',
    fieldRequirements: {
      deposit: [
        { key: 'walletAddress', label: 'Wallet Address', required: true, placeholder: 'G...' },
        { key: 'amount', label: 'Amount', required: true, placeholder: '500.00' },
      ],
      withdraw: [
        { key: 'bankAccount', label: 'Bank Account', required: true, placeholder: 'Account number' },
        { key: 'amount', label: 'Amount', required: true, placeholder: '120.50' },
      ],
      kyc: [
        { key: 'firstName', label: 'First Name', required: true },
        { key: 'lastName', label: 'Last Name', required: true },
        { key: 'country', label: 'Country', required: true },
      ],
    },
  }),
});

export type DynamicConfig = z.infer<typeof dynamicConfigSchema>;
export type DashboardUiConfig = DynamicConfig['ui'];

export const initialDynamicConfig: DynamicConfig = dynamicConfigSchema.parse({
  JWT_SECRET: config.JWT_SECRET,
  INTERACTIVE_URL: config.INTERACTIVE_URL,
  WEBHOOK_URL: config.WEBHOOK_URL,
  WEBHOOK_SECRET: config.WEBHOOK_SECRET,
  WEBHOOK_TIMEOUT_MS: config.WEBHOOK_TIMEOUT_MS,
  WEBHOOK_MAX_RETRIES: config.WEBHOOK_MAX_RETRIES,
  WEBHOOK_RETRY_DELAY_MS: config.WEBHOOK_RETRY_DELAY_MS,
  STELLAR_NETWORK: config.STELLAR_NETWORK,
  STELLAR_HORIZON_URL: config.STELLAR_HORIZON_URL,
  STELLAR_FEE_BUMP_SECRET: config.STELLAR_FEE_BUMP_SECRET,
  STELLAR_BASE_FEE: config.STELLAR_BASE_FEE,
});
