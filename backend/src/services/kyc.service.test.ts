import {
  buildInteractiveUrl,
  createDepositInteractiveUrl,
  createWithdrawInteractiveUrl,
  isSupportedAsset,
  normalizeAssetCode,
  SUPPORTED_ASSETS
} from './kyc.service';

describe('KYC Service', () => {
  it('normalizeAssetCode trims and uppercases', () => {
    expect(normalizeAssetCode(' usdc ')).toBe('USDC');
  });

  it('isSupportedAsset is case-insensitive', () => {
    expect(isSupportedAsset('usdc')).toBe(true);
    expect(isSupportedAsset('doge')).toBe(false);
  });

  it('buildInteractiveUrl includes required query params and defaults lang to en', () => {
    const url = buildInteractiveUrl({
      baseUrl: 'http://localhost:3000',
      transactionId: 'tx_1',
      assetCode: 'USDC',
      path: '/kyc-deposit'
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/kyc-deposit');
    expect(parsed.searchParams.get('transaction_id')).toBe('tx_1');
    expect(parsed.searchParams.get('asset_code')).toBe('USDC');
    expect(parsed.searchParams.get('lang')).toBe('en');
    expect(parsed.searchParams.get('account')).toBeNull();
    expect(parsed.searchParams.get('amount')).toBeNull();
  });

  it('createDepositInteractiveUrl composes query params and normalizes asset code', () => {
    const url = createDepositInteractiveUrl({
      baseUrl: 'http://example.com',
      transactionId: 'tx_2',
      assetCode: 'usdc',
      account: 'GACCOUNT',
      amount: '12.50',
      lang: 'fr'
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/kyc-deposit');
    expect(parsed.searchParams.get('transaction_id')).toBe('tx_2');
    expect(parsed.searchParams.get('asset_code')).toBe('USDC');
    expect(parsed.searchParams.get('account')).toBe('GACCOUNT');
    expect(parsed.searchParams.get('amount')).toBe('12.50');
    expect(parsed.searchParams.get('lang')).toBe('fr');
  });

  it('createWithdrawInteractiveUrl uses the withdraw path', () => {
    const url = createWithdrawInteractiveUrl({
      baseUrl: 'http://example.com',
      transactionId: 'tx_3',
      assetCode: SUPPORTED_ASSETS[0]
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/kyc-withdraw');
    expect(parsed.searchParams.get('transaction_id')).toBe('tx_3');
  });
});

