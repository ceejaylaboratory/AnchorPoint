import { Request, Response } from 'express';
import { ASSETS } from '../../config/assets';

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
  accounts: { receiving: string; distribution?: string };
  assets: StellarAsset[];
  signing_key: string;
  horizon_url: string;
  url: string;
  documentation?: string;
  preflight_commit?: boolean;
  fee_variations?: {
    deposit?: Record<string, { min_amount?: string; max_amount?: string; fee_fixed?: number; fee_percent?: number; fee_minimum?: number }>;
    withdraw?: Record<string, { min_amount?: string; max_amount?: string; fee_fixed?: number; fee_percent?: number; fee_minimum?: number }>;
  };
}



export const getInfo = (req: Request, res: Response): Response => {
  const format = req.query.format as string;
  const acceptHeader = req.headers.accept || '';
  const isToml = format === 'toml' || acceptHeader.includes('text/toml') || acceptHeader.includes('application/toml');

  const feeVariationEntries = (type: 'deposit' | 'withdraw') =>
    Object.fromEntries(
      ASSETS
        .filter(a => type === 'deposit' ? a.depositEnabled : a.withdrawEnabled)
        .map(a => [a.code, { min_amount: a.minAmount, max_amount: a.maxAmount, fee_fixed: a.feeFixed, fee_percent: a.feePercent, fee_minimum: a.feeMinimum }])
    );

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
      distribution: process.env.DISTRIBUTION_ACCOUNT,
    },
    assets: ASSETS.map(a => ({
      code: a.code,
      issuer: a.issuer,
      status: 'live',
      is_asset_anchored: true,
      anchored_asset_type: a.type,
      desc: a.desc,
      max_amount: a.maxAmount,
      min_amount: a.minAmount,
      fee_fixed: a.feeFixed,
      fee_percent: a.feePercent,
      fee_minimum: a.feeMinimum,
    })),
    signing_key: process.env.SIGNING_KEY || 'SB2Q6JYYK7GKXQJYRJLJHZFAP2Y7VJMLMIEUJQGHQFJ2D2K5A4HQKMF',
    horizon_url: process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org',
    url: process.env.BASE_URL || 'http://localhost:3002',
    documentation: process.env.DOCUMENTATION_URL,
    preflight_commit: process.env.PREFLIGHT_COMMIT === 'true',
    fee_variations: {
      deposit: feeVariationEntries('deposit'),
      withdraw: feeVariationEntries('withdraw'),
    },
  };

  const filteredInfo = Object.fromEntries(
    Object.entries(stellarInfo).filter(([, v]) => v !== undefined)
  ) as StellarInfo;

  if (isToml) {
    res.setHeader('Content-Type', 'text/toml');
    return res.send(convertToTOML(filteredInfo));
  }

  return res.json(filteredInfo);
};


function convertToTOML(info: StellarInfo): string {
  const lines: string[] = [
    `version = "${info.version}"`,
    `network = "${info.network}"`,
    `signing_key = "${info.signing_key}"`,
    `horizon_url = "${info.horizon_url}"`,
    `url = "${info.url}"`,
  ];

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

  lines.push('', '[accounts]', `receiving = "${info.accounts.receiving}"`);
  if (info.accounts.distribution) lines.push(`distribution = "${info.accounts.distribution}"`);

  info.assets.forEach(asset => {
    lines.push('', '[[assets]]', `code = "${asset.code}"`);
    if (asset.issuer) lines.push(`issuer = "${asset.issuer}"`);
    lines.push(
      `status = "${asset.status}"`,
      `is_asset_anchored = ${asset.is_asset_anchored}`,
      `anchored_asset_type = "${asset.anchored_asset_type}"`,
      `desc = "${asset.desc}"`,
    );
    if (asset.max_amount) lines.push(`max_amount = "${asset.max_amount}"`);
    if (asset.min_amount) lines.push(`min_amount = "${asset.min_amount}"`);
    if (asset.fee_fixed !== undefined) lines.push(`fee_fixed = ${asset.fee_fixed}`);
    if (asset.fee_percent !== undefined) lines.push(`fee_percent = ${asset.fee_percent}`);
    if (asset.fee_minimum !== undefined) lines.push(`fee_minimum = ${asset.fee_minimum}`);
  });

  
  // Add fee variations if present
  if (info.fee_variations) {
    if (info.fee_variations.deposit) {
      lines.push('');
      lines.push('[fee_variations.deposit]');
      Object.entries(info.fee_variations.deposit).forEach(([assetCode, fees]) => {
        lines.push(`[fee_variations.deposit.${assetCode}]`);
        Object.entries(fees).forEach(([key, value]) => {
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
        Object.entries(fees).forEach(([key, value]) => {
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
