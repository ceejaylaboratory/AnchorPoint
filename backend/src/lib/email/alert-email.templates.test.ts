import {
  renderHotWalletLowBalanceAlert,
  renderSystemAlert,
} from './alert-email.templates';

describe('alert email templates', () => {
  it('renders hot wallet low balance subject and body fields', () => {
    const content = renderHotWalletLowBalanceAlert({
      walletLabel: 'Main XLM',
      publicKey: 'GABC123',
      assetCode: 'XLM',
      currentBalance: 12.5,
      thresholdAmount: 100,
      checkedAt: '2026-05-30T12:00:00.000Z',
    });

    expect(content.subject).toBe('[AnchorPoint] Low Balance Alert: Main XLM');
    expect(content.text).toContain('Main XLM');
    expect(content.text).toContain('GABC123');
    expect(content.html).toContain('Hot Wallet Low Balance');
    expect(content.html).toContain('12.5');
  });

  it('escapes HTML in system alert messages', () => {
    const content = renderSystemAlert({
      severity: 'critical',
      metric: 'error_rate',
      message: '<script>alert(1)</script>',
      value: '7%',
      threshold: '5%',
      window: '5m',
      detectedAt: '2026-05-30T12:00:00.000Z',
    });

    expect(content.subject).toContain('[CRITICAL]');
    expect(content.html).not.toContain('<script>');
    expect(content.html).toContain('&lt;script&gt;');
  });
});
