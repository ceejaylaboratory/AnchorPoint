import { NetworkType } from './networks';

/**
 * Multi-asset configuration for the anchor.
 * Add or remove assets here to dynamically update all SEP endpoints.
 */

/**
 * Determines how the anchor calculates fees for a given asset.
 *
 *  - `flat`       – only `feeFixed` is charged, regardless of amount.
 *  - `percentage`  – only `feePercent` is applied (subject to `feeMinimum`).
 *  - `tiered`      – both `feeFixed` and `feePercent` apply (subject to `feeMinimum`).
 */
export type FeeType = 'flat' | 'percentage' | 'tiered';

export interface AssetConfig {
  code: string;
  issuers: Partial<Record<NetworkType, string>>; // Network-specific issuer addresses
  type: 'fiat' | 'crypto' | 'other';
  desc: string;
  minAmount: string;
  maxAmount: string;
  /** Strategy used to compute fees for this asset. */
  feeType: FeeType;
  feeFixed: number;
  feePercent: number;
  feeMinimum: number;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
}

export const ASSETS: AssetConfig[] = [
  {
    code: 'USDC',
    issuers: {
      [NetworkType.PUBLIC]: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      [NetworkType.TESTNET]: 'GBBD47IF6LWLVNC7F7YSACOA73YI4COI3V5O2S46F7S44GUL44YQY4O2', // Example testnet issuer
      [NetworkType.FUTURENET]: 'GBBD47IF6LWLVNC7F7YSACOA73YI4COI3V5O2S46F7S44GUL44YQY4O2',
    },
    type: 'fiat',
    desc: 'USD Coin - a fully collateralized US dollar stablecoin',
    minAmount: '0.01',
    maxAmount: '1000000',
    feeType: 'flat',
    feeFixed: 0.5,
    feePercent: 0,
    feeMinimum: 0,
    depositEnabled: true,
    withdrawEnabled: true,
  },
  {
    code: 'USD',
    issuers: {}, // No issuer for traditional fiat representation
    type: 'fiat',
    desc: 'US Dollar - traditional currency',
    minAmount: '0.01',
    maxAmount: '1000000',
    feeType: 'tiered',
    feeFixed: 0.5,
    feePercent: 0.005,
    feeMinimum: 0.5,
    depositEnabled: true,
    withdrawEnabled: true,
  },
];

/** Map of asset code -> AssetConfig for O(1) lookups */
export const ASSET_MAP: Record<string, AssetConfig> = Object.fromEntries(
  ASSETS.map(a => [a.code, a])
);

export const SUPPORTED_ASSET_CODES = ASSETS.map(a => a.code);

export const getAsset = (code: string): AssetConfig | undefined =>
  ASSET_MAP[code.trim().toUpperCase()];

export const getIssuer = (code: string, network: NetworkType): string | undefined =>
  getAsset(code)?.issuers[network];

export const isDepositSupported = (code: string): boolean =>
  getAsset(code)?.depositEnabled ?? false;

export const isWithdrawSupported = (code: string): boolean =>
  getAsset(code)?.withdrawEnabled ?? false;
