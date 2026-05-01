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
  RECURRING_PAYMENTS_WORKER_CRON: z.string().default('*/1 * * * *'),
  STELLAR_NETWORK: z.enum(['testnet', 'public']).default('testnet'),
  STELLAR_NETWORK_PASSPHRASE: z
    .string()
    .default('Test SDF Network ; September 2015'),
  STELLAR_HORIZON_URL: z.string().url().default('https://horizon-testnet.stellar.org'),
  STELLAR_FEE_BUMP_SECRET: z.string().optional(),
  STELLAR_DISTRIBUTION_SECRET: z.string().optional(),
  STELLAR_BASE_FEE: z.string().default('100'),
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
