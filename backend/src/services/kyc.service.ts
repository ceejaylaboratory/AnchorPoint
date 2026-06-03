import { SUPPORTED_ASSET_CODES, getAsset, isDepositSupported, isWithdrawSupported } from '../config/assets';
import {
  InteractiveFlow,
  signInteractiveToken,
} from './sep24-interactive-token.service';

// Re-export for backward compatibility
export { SUPPORTED_ASSET_CODES as SUPPORTED_ASSETS };
export { getAsset, isDepositSupported, isWithdrawSupported };

export type SupportedAsset = string;

export const normalizeAssetCode = (assetCode: string): string =>
  assetCode.trim().toUpperCase();

export const isSupportedAsset = (assetCode: string): boolean =>
  getAsset(assetCode) !== undefined;

interface InteractiveUrlParams {
  baseUrl: string;
  transactionId: string;
  assetCode: string;
  account?: string;
  amount?: string;
  lang?: string;
  path: string;
  flow: InteractiveFlow;
}

export const buildInteractiveUrl = ({
  baseUrl,
  transactionId,
  assetCode,
  account,
  amount,
  lang = 'en',
  path,
  flow,
}: InteractiveUrlParams): string => {
  const token = signInteractiveToken({
    transactionId,
    account,
    assetCode,
    amount,
    lang,
    flow,
  });

  const url = new URL(path, baseUrl);
  url.searchParams.append('transaction_id', transactionId);
  url.searchParams.append('asset_code', assetCode);
  if (account) url.searchParams.append('account', account);
  if (amount) url.searchParams.append('amount', amount);
  url.searchParams.append('lang', lang);
  url.searchParams.append('token', token);
  return url.toString();
};

export const createDepositInteractiveUrl = (params: {
  baseUrl: string;
  transactionId: string;
  assetCode: string;
  account?: string;
  amount?: string;
  lang?: string;
}): string =>
  buildInteractiveUrl({
    ...params,
    path: '/kyc-deposit',
    assetCode: normalizeAssetCode(params.assetCode),
    flow: 'deposit',
  });

export const createWithdrawInteractiveUrl = (params: {
  baseUrl: string;
  transactionId: string;
  assetCode: string;
  account?: string;
  amount?: string;
  lang?: string;
}): string =>
  buildInteractiveUrl({
    ...params,
    path: '/kyc-withdraw',
    assetCode: normalizeAssetCode(params.assetCode),
    flow: 'withdraw',
  });
