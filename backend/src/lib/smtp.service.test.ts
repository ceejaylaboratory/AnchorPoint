const mockConfig = {
  SMTP_HOST: undefined as string | undefined,
  SMTP_PORT: undefined as number | undefined,
  SMTP_USER: undefined as string | undefined,
  SMTP_PASS: undefined as string | undefined,
  SMTP_FROM: undefined as string | undefined,
};

jest.mock('../config/env', () => ({
  config: mockConfig,
}));

jest.mock('nodemailer');
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import { SmtpService } from './smtp.service';

const mockedNodemailer = nodemailer as jest.Mocked<typeof nodemailer>;
const sendMail = jest.fn();

describe('SmtpService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SmtpService as any).instance = undefined;
    mockedNodemailer.createTransport.mockReturnValue({ sendMail } as any);
    sendMail.mockResolvedValue({ messageId: 'test-id' });

    mockConfig.SMTP_HOST = undefined;
    mockConfig.SMTP_PORT = undefined;
    mockConfig.SMTP_USER = undefined;
    mockConfig.SMTP_PASS = undefined;
    mockConfig.SMTP_FROM = undefined;
  });

  it('reports unconfigured when required SMTP env vars are missing', () => {
    const service = SmtpService.getInstance();

    expect(service.isConfigured()).toBe(false);
  });

  it('logs and skips delivery when SMTP is not configured', async () => {
    const service = SmtpService.getInstance();

    const sent = await service.sendMail({
      to: 'user@example.com',
      subject: 'Test',
      text: 'Hello',
    });

    expect(sent).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      'SMTP not configured; email logged for development',
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Test',
      })
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends mail when SMTP is configured', async () => {
    mockConfig.SMTP_HOST = 'smtp.example.com';
    mockConfig.SMTP_PORT = 587;
    mockConfig.SMTP_FROM = 'noreply@example.com';
    mockConfig.SMTP_USER = 'smtp-user';
    mockConfig.SMTP_PASS = 'smtp-pass';

    const service = SmtpService.getInstance();
    expect(service.isConfigured()).toBe(true);

    const sent = await service.sendMail({
      to: 'user@example.com',
      subject: 'AnchorPoint Alert',
      text: 'Balance is low',
    });

    expect(sent).toBe(true);
    expect(mockedNodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: 'smtp-user',
        pass: 'smtp-pass',
      },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'AnchorPoint Alert',
      text: 'Balance is low',
      html: undefined,
    });
  });

  it('logs and rethrows when SMTP delivery fails', async () => {
    mockConfig.SMTP_HOST = 'smtp.example.com';
    mockConfig.SMTP_PORT = 465;
    mockConfig.SMTP_FROM = 'noreply@example.com';
    sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'));

    const service = SmtpService.getInstance();

    await expect(
      service.sendMail({
        to: 'user@example.com',
        subject: 'Failure',
        text: 'Hello',
      })
    ).rejects.toThrow('SMTP unavailable');

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to send email via SMTP',
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Failure',
      })
    );
  });
});
