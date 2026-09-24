import sgMail from '@sendgrid/mail';
import {
  ConsolePushProvider,
  ConsoleSmsProvider,
  FcmPushProvider,
  SendGridEmailProvider,
  TwilioSmsProvider,
  createEmailProvider,
  createPushProvider,
  createSmsProvider,
  sendNotification,
} from './providers';
import { NotificationType } from '../../services/notification.service';

jest.mock('../../utils/logger');
jest.mock('../../lib/prisma', () => ({ __esModule: true, default: {} }));
jest.mock('@sendgrid/mail', () => ({
  __esModule: true,
  default: { setApiKey: jest.fn(), send: jest.fn() },
}));

const https = require('https');

describe('FcmPushProvider', () => {
  let provider: FcmPushProvider;

  beforeEach(() => {
    provider = new FcmPushProvider();
    jest.clearAllMocks();
  });

  it('should return false when FCM_SERVER_KEY is not configured', async () => {
    delete process.env.FCM_SERVER_KEY;
    const result = await provider.send('test-token', 'Test message');
    expect(result).toBe(false);
  });

  it('should return false when the request encounters a network error', async () => {
    process.env.FCM_SERVER_KEY = 'test-server-key';
    const mockReq = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn().mockImplementation((_event, handler) => {
        handler(new Error('Network error'));
      }),
    };
    jest.spyOn(https, 'request').mockReturnValue(mockReq as any);

    const result = await provider.send('test-token', 'Test message');
    expect(result).toBe(false);
  });

  it('should return false when FCM returns a non-200 status code', async () => {
    process.env.FCM_SERVER_KEY = 'test-server-key';
    const mockRes = {
      statusCode: 401,
      on: jest.fn().mockImplementation((_event, handler) => {
        handler('Unauthorized');
      }),
      once: jest.fn(),
    };
    const mockReq = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn().mockImplementation((_event, handler) => {
        handler(mockRes);
      }),
    };
    jest.spyOn(https, 'request').mockReturnValue(mockReq as any);

    const result = await provider.send('test-token', 'Test message');
    expect(result).toBe(false);
  });

  it('should return true when FCM returns 200', async () => {
    process.env.FCM_SERVER_KEY = 'test-server-key';
    const mockRes = {
      statusCode: 200,
      on: jest.fn().mockImplementation((event, handler) => {
        if (event === 'data') {
          handler(JSON.stringify({ name: 'projects/anchor-point/messages/123' }));
        }
        if (event === 'end') {
          handler();
        }
      }),
      once: jest.fn(),
    };
    const mockReq = { write: jest.fn(), end: jest.fn(), on: jest.fn() };
    jest.spyOn(https, 'request').mockImplementation((_opts: any, cb: any) => {
      cb(mockRes);
      return mockReq as any;
    });

    const result = await provider.send('test-fcm-token', 'Hello notification');
    expect(result).toBe(true);
  });
});
describe('TwilioSmsProvider', () => {
  const provider = new TwilioSmsProvider();

  const mockHttps = (statusCode: number) => {
    const mockRes = {
      statusCode,
      on: jest.fn().mockImplementation((event, handler) => {
        if (event === 'data') handler('{}');
        if (event === 'end') handler();
      }),
    };
    const mockReq = { write: jest.fn(), end: jest.fn(), on: jest.fn() };
    const spy = jest.spyOn(https, 'request').mockImplementation((_opts: any, cb: any) => {
      cb(mockRes);
      return mockReq;
    });
    return { spy, mockReq };
  };

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  });

  it('returns false when Twilio is not configured', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    expect(await provider.send('+15551234567', 'hi')).toBe(false);
  });

  it('posts the message to the Twilio Messages API', async () => {
    const { spy, mockReq } = mockHttps(201);

    expect(await provider.send('+15551234567', 'Deposit completed')).toBe(true);

    const opts = spy.mock.calls[0][0] as any;
    expect(opts.hostname).toBe('api.twilio.com');
    expect(opts.path).toBe('/2010-04-01/Accounts/AC123/Messages.json');
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from('AC123:secret').toString('base64')}`);
    const body = new URLSearchParams(mockReq.write.mock.calls[0][0]);
    expect(body.get('To')).toBe('+15551234567');
    expect(body.get('From')).toBe('+15005550006');
    expect(body.get('Body')).toBe('Deposit completed');
  });

  it('returns false when Twilio responds with an error status', async () => {
    mockHttps(400);
    expect(await provider.send('+15551234567', 'hi')).toBe(false);
  });
});

describe('SendGridEmailProvider', () => {
  const provider = new SendGridEmailProvider();

  beforeEach(() => {
    process.env.SENDGRID_API_KEY = 'SG.test';
    process.env.SENDGRID_FROM = 'noreply@example.com';
    (sgMail.send as jest.Mock).mockReset();
  });

  afterEach(() => {
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_FROM;
  });

  it('sends the email through SendGrid', async () => {
    (sgMail.send as jest.Mock).mockResolvedValue([{ statusCode: 202 }]);

    expect(await provider.send('user@example.com', 'Withdrawal signed off')).toBe(true);
    expect(sgMail.setApiKey).toHaveBeenCalledWith('SG.test');
    expect(sgMail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        from: 'noreply@example.com',
        text: 'Withdrawal signed off',
      }),
    );
  });

  it('returns false when SendGrid rejects the request', async () => {
    (sgMail.send as jest.Mock).mockRejectedValue(new Error('Forbidden'));
    expect(await provider.send('user@example.com', 'hi')).toBe(false);
  });
});

describe('provider selection & sendNotification', () => {
  const envKeys = [
    'SENDGRID_API_KEY',
    'SENDGRID_FROM',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'FCM_SERVER_KEY',
  ];

  afterEach(() => {
    envKeys.forEach((key) => delete process.env[key]);
  });

  it('falls back to console providers when nothing is configured', () => {
    envKeys.forEach((key) => delete process.env[key]);
    expect(createSmsProvider()).toBeInstanceOf(ConsoleSmsProvider);
    expect(createPushProvider()).toBeInstanceOf(ConsolePushProvider);
  });

  it('selects SendGrid, Twilio and FCM when their env vars are set', () => {
    process.env.SENDGRID_API_KEY = 'SG.test';
    process.env.SENDGRID_FROM = 'noreply@example.com';
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
    process.env.FCM_SERVER_KEY = 'key';

    expect(createEmailProvider()).toBeInstanceOf(SendGridEmailProvider);
    expect(createSmsProvider()).toBeInstanceOf(TwilioSmsProvider);
    expect(createPushProvider()).toBeInstanceOf(FcmPushProvider);
  });

  it('dispatches to the provider for the requested channel', async () => {
    const smsSpy = jest.spyOn(ConsoleSmsProvider.prototype, 'send').mockResolvedValue(true);
    const pushSpy = jest.spyOn(ConsolePushProvider.prototype, 'send');

    expect(await sendNotification(NotificationType.SMS, '+15551234567', 'hello')).toBe(true);
    expect(smsSpy).toHaveBeenCalledWith('+15551234567', 'hello');
    expect(pushSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('returns false for an unsupported channel', async () => {
    expect(await sendNotification('FAX' as NotificationType, 'x', 'y')).toBe(false);
  });
});
