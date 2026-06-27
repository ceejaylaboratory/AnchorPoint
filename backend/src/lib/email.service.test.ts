import { sendEmail, EmailPayload } from './email.service';

const payload: EmailPayload = {
  to: 'user@example.com',
  from: 'noreply@anchorpoint.app',
  subject: 'Test',
  text: 'Hello',
};

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn(),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({}),
  }),
}));

import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';

describe('sendEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SMTP_HOST;
  });

  it('sends via SendGrid when SENDGRID_API_KEY is set', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test';
    (sgMail.send as jest.Mock).mockResolvedValue([{ statusCode: 202 }]);

    await sendEmail(payload);

    expect(sgMail.setApiKey).toHaveBeenCalledWith('SG.test');
    expect(sgMail.send).toHaveBeenCalledTimes(1);
  });

  it('falls back to Nodemailer when SendGrid fails', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test';
    process.env.SMTP_HOST = 'smtp.example.com';
    (sgMail.send as jest.Mock).mockRejectedValue(new Error('SendGrid error'));
    const mockSendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: mockSendMail });

    await sendEmail(payload);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('sends via Nodemailer when only SMTP_HOST is set', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    const mockSendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: mockSendMail });

    await sendEmail(payload);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(sgMail.send).not.toHaveBeenCalled();
  });

  it('does not throw when no transport is configured', async () => {
    await expect(sendEmail(payload)).resolves.not.toThrow();
  });
});
