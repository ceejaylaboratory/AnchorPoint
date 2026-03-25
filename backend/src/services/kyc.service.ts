export const SUPPORTED_ASSETS = ['USDC', 'USD', 'BTC', 'ETH'] as const;

export type SupportedAsset = (typeof SUPPORTED_ASSETS)[number];

export const normalizeAssetCode = (assetCode: string): string => {
  return assetCode.trim().toUpperCase();
};

export const isSupportedAsset = (assetCode: string): assetCode is SupportedAsset => {
  return (SUPPORTED_ASSETS as readonly string[]).includes(normalizeAssetCode(assetCode));
};

interface InteractiveUrlParams {
  baseUrl: string;
  transactionId: string;
  assetCode: string;
  account?: string;
  amount?: string;
  lang?: string;
  path: string;
}

export const buildInteractiveUrl = ({
  baseUrl,
  transactionId,
  assetCode,
  account,
  amount,
  lang = 'en',
  path,
}: InteractiveUrlParams): string => {
  const url = new URL(path, baseUrl);
  url.searchParams.append('transaction_id', transactionId);
  url.searchParams.append('asset_code', assetCode);
  if (account) url.searchParams.append('account', account);
  if (amount) url.searchParams.append('amount', amount);
  url.searchParams.append('lang', lang);
  return url.toString();
};

export const createDepositInteractiveUrl = (params: {
  baseUrl: string;
  transactionId: string;
  assetCode: string;
  account?: string;
  amount?: string;
  lang?: string;
}): string => {
  return buildInteractiveUrl({ ...params, path: '/kyc-deposit', assetCode: normalizeAssetCode(params.assetCode) });
};

export const createWithdrawInteractiveUrl = (params: {
  baseUrl: string;
  transactionId: string;
  assetCode: string;
  account?: string;
  amount?: string;
  lang?: string;
}): string => {
  return buildInteractiveUrl({ ...params, path: '/kyc-withdraw', assetCode: normalizeAssetCode(params.assetCode) });
};

