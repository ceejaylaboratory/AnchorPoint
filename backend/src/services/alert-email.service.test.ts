import * as smtp from '../lib/smtp/create-transporter';
import { SmtpAlertEmailService } from './alert-email.service';

jest.mock('../config/env', () => ({
  config: { SMTP_FROM: 'alerts@example.com' },
}));
jest.mock('../lib/smtp/create-transporter');
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('SmtpAlertEmailService', () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
  const mockedSmtp = smtp as jest.Mocked<typeof smtp>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSmtp.isSmtpConfigured.mockReturnValue(true);
    mockedSmtp.parseEmailRecipients.mockImplementation((value: string) =>
      value.split(',').map((entry) => entry.trim()).filter(Boolean),
    );
    mockedSmtp.createSmtpTransporter.mockReturnValue({ sendMail } as never);
  });

  it('sends hot wallet alert email when SMTP is configured', async () => {
    const service = new SmtpAlertEmailService();

    await service.sendHotWalletLowBalanceAlert('ops@example.com, finance@example.com', {
      walletLabel: 'Main XLM',
      publicKey: 'GABC123',
      assetCode: 'XLM',
      currentBalance: 10,
      thresholdAmount: 100,
      checkedAt: '2026-05-30T12:00:00.000Z',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'alerts@example.com',
        to: 'ops@example.com, finance@example.com',
        subject: '[AnchorPoint] Low Balance Alert: Main XLM',
      }),
    );
  });

  it('logs instead of sending when SMTP is not configured', async () => {
    mockedSmtp.isSmtpConfigured.mockReturnValue(false);
    const service = new SmtpAlertEmailService();

    await service.sendHotWalletLowBalanceAlert('ops@example.com', {
      walletLabel: 'Main XLM',
      publicKey: 'GABC123',
      assetCode: 'XLM',
      currentBalance: 10,
      thresholdAmount: 100,
      checkedAt: '2026-05-30T12:00:00.000Z',
    });

    expect(sendMail).not.toHaveBeenCalled();
    expect(mockedSmtp.createSmtpTransporter).not.toHaveBeenCalled();
  });
});
