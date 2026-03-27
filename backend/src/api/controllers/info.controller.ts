import { Request, Response } from 'express';
import { SUPPORTED_ASSETS } from '../../services/kyc.service';

export interface StellarAsset {
  code: string;
  issuer?: string;
  status: string;
  is_asset_anchored: boolean;
  anchored_asset_type: string;
  desc: string;
  conditions?: string;
  max_amount?: string;
  min_amount?: string;
  fee_fixed?: number;
  fee_percent?: number;
  fee_minimum?: number;
}

export interface StellarInfo {
  version: string;
  network: string;
  federation_server?: string;
  auth_server?: string;
  kyc_server?: string;
  web_auth_endpoint?: string;
  transfer_server?: string;
  transfer_server_sep24?: string;
  deposit_server?: string;
  withdrawal_server?: string;
  accounts: {
    receiving: string;
    distribution?: string;
  };
  assets: StellarAsset[];
  signing_key: string;
  horizon_url: string;
  url: string;
  documentation?: string;
  preflight_commit?: boolean;
  fee_variations?: {
    deposit?: {
      [asset_code: string]: {
        min_amount?: string;
        max_amount?: string;
        fee_fixed?: number;
        fee_percent?: number;
        fee_minimum?: number;
      };
    };
    withdraw?: {
      [asset_code: string]: {
        min_amount?: string;
        max_amount?: string;
        fee_fixed?: number;
        fee_percent?: number;
        fee_minimum?: number;
      };
    };
  };
}

export const getInfo = (req: Request, res: Response): Response => {
  const format = req.query.format as string;
  const acceptHeader = req.headers.accept || '';
  
  // Determine response format
  const isToml = format === 'toml' || acceptHeader.includes('text/toml') || acceptHeader.includes('application/toml');
  
  // Get configuration from environment variables
  const stellarInfo: StellarInfo = {
    version: '1.0.0',
    network: process.env.STELLAR_NETWORK || 'testnet',
    federation_server: process.env.FEDERATION_SERVER,
    auth_server: process.env.AUTH_SERVER,
    kyc_server: process.env.KYC_SERVER,
    web_auth_endpoint: process.env.WEB_AUTH_ENDPOINT,
    transfer_server: process.env.TRANSFER_SERVER,
    transfer_server_sep24: process.env.TRANSFER_SERVER_SEP24 || `${process.env.BASE_URL || 'http://localhost:3002'}/sep24`,
    deposit_server: process.env.DEPOSIT_SERVER,
    withdrawal_server: process.env.WITHDRAWAL_SERVER,
    accounts: {
      receiving: process.env.RECEIVING_ACCOUNT || 'GD5DJQDKEBTHBQC7LKLDSLRGEA3KMRMFOKMJUEKSFZLWQ5E2PJDJYZNF',
      distribution: process.env.DISTRIBUTION_ACCOUNT
    },
    assets: SUPPORTED_ASSETS.map(asset => ({
      code: asset,
      status: 'live',
      is_asset_anchored: true,
      anchored_asset_type: getAssetType(asset),
      desc: getAssetDescription(asset),
      max_amount: getMaxAmount(asset),
      min_amount: getMinAmount(asset),
      fee_fixed: getFeeFixed(asset),
      fee_percent: getFeePercent(asset),
      fee_minimum: getFeeMinimum(asset)
    })),
    signing_key: process.env.SIGNING_KEY || 'SB2Q6JYYK7GKXQJYRJLJHZFAP2Y7VJMLMIEUJQGHQFJ2D2K5A4HQKMF',
    horizon_url: process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org',
    url: process.env.BASE_URL || 'http://localhost:3002',
    documentation: process.env.DOCUMENTATION_URL,
    preflight_commit: process.env.PREFLIGHT_COMMIT === 'true',
    fee_variations: {
      deposit: getDepositFeeVariations(),
      withdraw: getWithdrawFeeVariations()
    }
  };

  // Filter out undefined values
  const filteredInfo = Object.fromEntries(
    Object.entries(stellarInfo).filter(([_, value]) => value !== undefined)
  ) as StellarInfo;

  if (isToml) {
    // Convert to TOML format
    const tomlContent = convertToTOML(filteredInfo);
    res.setHeader('Content-Type', 'text/toml');
    return res.send(tomlContent);
  }

  return res.json(filteredInfo);
};

// Helper functions to generate asset information
function getAssetType(asset: string): string {
  switch (asset) {
    case 'USDC':
      return 'fiat';
    case 'USD':
      return 'fiat';
    case 'BTC':
      return 'crypto';
    case 'ETH':
      return 'crypto';
    default:
      return 'other';
  }
}

function getAssetDescription(asset: string): string {
  switch (asset) {
    case 'USDC':
      return 'USD Coin - a fully collateralized US dollar stablecoin';
    case 'USD':
      return 'US Dollar - traditional currency';
    case 'BTC':
      return 'Bitcoin - decentralized digital currency';
    case 'ETH':
      return 'Ethereum - smart contract platform';
    default:
      return `${asset} - supported asset`;
  }
}

function getMaxAmount(asset: string): string {
  const maxAmounts: { [key: string]: string } = {
    'USDC': '1000000',
    'USD': '1000000',
    'BTC': '100',
    'ETH': '1000'
  };
  return maxAmounts[asset] || '1000000';
}

function getMinAmount(asset: string): string {
  const minAmounts: { [key: string]: string } = {
    'USDC': '0.01',
    'USD': '0.01',
    'BTC': '0.00001',
    'ETH': '0.001'
  };
  return minAmounts[asset] || '0.01';
}

function getFeeFixed(asset: string): number {
  const feeFixed: { [key: string]: number } = {
    'USDC': 0.50,
    'USD': 0.50,
    'BTC': 0.001,
    'ETH': 0.01
  };
  return feeFixed[asset] || 0.50;
}

function getFeePercent(asset: string): number {
  const feePercent: { [key: string]: number } = {
    'USDC': 0.005,
    'USD': 0.005,
    'BTC': 0.01,
    'ETH': 0.01
  };
  return feePercent[asset] || 0.005;
}

function getFeeMinimum(asset: string): number {
  const feeMinimum: { [key: string]: number } = {
    'USDC': 0.50,
    'USD': 0.50,
    'BTC': 0.001,
    'ETH': 0.01
  };
  return feeMinimum[asset] || 0.50;
}

function getDepositFeeVariations() {
  const variations: { [key: string]: any } = {};
  SUPPORTED_ASSETS.forEach(asset => {
    variations[asset] = {
      min_amount: getMinAmount(asset),
      max_amount: getMaxAmount(asset),
      fee_fixed: getFeeFixed(asset),
      fee_percent: getFeePercent(asset),
      fee_minimum: getFeeMinimum(asset)
    };
  });
  return variations;
}

function getWithdrawFeeVariations() {
  const variations: { [key: string]: any } = {};
  SUPPORTED_ASSETS.forEach(asset => {
    variations[asset] = {
      min_amount: getMinAmount(asset),
      max_amount: getMaxAmount(asset),
      fee_fixed: getFeeFixed(asset),
      fee_percent: getFeePercent(asset),
      fee_minimum: getFeeMinimum(asset)
    };
  });
  return variations;
}

function convertToTOML(info: StellarInfo): string {
  const lines: string[] = [];
  
  // Add basic info
  lines.push(`version = "${info.version}"`);
  lines.push(`network = "${info.network}"`);
  lines.push(`signing_key = "${info.signing_key}"`);
  lines.push(`horizon_url = "${info.horizon_url}"`);
  lines.push(`url = "${info.url}"`);
  
  if (info.federation_server) lines.push(`federation_server = "${info.federation_server}"`);
  if (info.auth_server) lines.push(`auth_server = "${info.auth_server}"`);
  if (info.kyc_server) lines.push(`kyc_server = "${info.kyc_server}"`);
  if (info.web_auth_endpoint) lines.push(`web_auth_endpoint = "${info.web_auth_endpoint}"`);
  if (info.transfer_server) lines.push(`transfer_server = "${info.transfer_server}"`);
  if (info.transfer_server_sep24) lines.push(`transfer_server_sep24 = "${info.transfer_server_sep24}"`);
  if (info.deposit_server) lines.push(`deposit_server = "${info.deposit_server}"`);
  if (info.withdrawal_server) lines.push(`withdrawal_server = "${info.withdrawal_server}"`);
  if (info.documentation) lines.push(`documentation = "${info.documentation}"`);
  if (info.preflight_commit !== undefined) lines.push(`preflight_commit = ${info.preflight_commit}`);
  
  // Add accounts
  lines.push('');
  lines.push('[accounts]');
  lines.push(`receiving = "${info.accounts.receiving}"`);
  if (info.accounts.distribution) {
    lines.push(`distribution = "${info.accounts.distribution}"`);
  }
  
  // Add assets
  lines.push('');
  info.assets.forEach((asset, index) => {
    lines.push(`[[assets]]`);
    lines.push(`code = "${asset.code}"`);
    lines.push(`status = "${asset.status}"`);
    lines.push(`is_asset_anchored = ${asset.is_asset_anchored}`);
    lines.push(`anchored_asset_type = "${asset.anchored_asset_type}"`);
    lines.push(`desc = "${asset.desc}"`);
    if (asset.conditions) lines.push(`conditions = "${asset.conditions}"`);
    if (asset.max_amount) lines.push(`max_amount = "${asset.max_amount}"`);
    if (asset.min_amount) lines.push(`min_amount = "${asset.min_amount}"`);
    if (asset.fee_fixed !== undefined) lines.push(`fee_fixed = ${asset.fee_fixed}`);
    if (asset.fee_percent !== undefined) lines.push(`fee_percent = ${asset.fee_percent}`);
    if (asset.fee_minimum !== undefined) lines.push(`fee_minimum = ${asset.fee_minimum}`);
    if (index < info.assets.length - 1) lines.push('');
  });
  
  // Add fee variations if present
  if (info.fee_variations) {
    if (info.fee_variations.deposit) {
      lines.push('');
      lines.push('[fee_variations.deposit]');
      Object.entries(info.fee_variations.deposit).forEach(([assetCode, fees]) => {
        lines.push(`[fee_variations.deposit.${assetCode}]`);
        Object.entries(fees as any).forEach(([key, value]) => {
          if (typeof value === 'string') {
            lines.push(`${key} = "${value}"`);
          } else {
            lines.push(`${key} = ${value}`);
          }
        });
      });
    }
    
    if (info.fee_variations.withdraw) {
      lines.push('');
      lines.push('[fee_variations.withdraw]');
      Object.entries(info.fee_variations.withdraw).forEach(([assetCode, fees]) => {
        lines.push(`[fee_variations.withdraw.${assetCode}]`);
        Object.entries(fees as any).forEach(([key, value]) => {
          if (typeof value === 'string') {
            lines.push(`${key} = "${value}"`);
          } else {
            lines.push(`${key} = ${value}`);
          }
        });
      });
    }
  }
  
  return lines.join('\n');
}
