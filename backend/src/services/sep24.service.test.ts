import { Sep24Service } from './sep24.service';

describe('Sep24Service', () => {
  describe('validateCallbackUrl', () => {
    it('returns false for empty url', () => {
      expect(Sep24Service.validateCallbackUrl('', ['example.com'])).toBe(false);
    });

    it('returns false for invalid url string', () => {
      expect(Sep24Service.validateCallbackUrl('not-a-url', ['example.com'])).toBe(false);
    });

    it('returns false for non http/https protocols', () => {
      expect(Sep24Service.validateCallbackUrl('ftp://example.com', ['example.com'])).toBe(false);
      expect(Sep24Service.validateCallbackUrl('javascript:alert(1)', ['example.com'])).toBe(false);
    });

    it('returns true if allowedDomains is empty', () => {
      expect(Sep24Service.validateCallbackUrl('https://malicious.com', [])).toBe(true);
    });

    it('returns true if domain exactly matches a whitelist entry', () => {
      expect(Sep24Service.validateCallbackUrl('https://example.com/callback', ['example.com'])).toBe(true);
    });

    it('returns true if domain is a subdomain of a whitelist entry', () => {
      expect(Sep24Service.validateCallbackUrl('https://sub.example.com/callback', ['example.com'])).toBe(true);
    });

    it('returns false if domain does not match whitelist', () => {
      expect(Sep24Service.validateCallbackUrl('https://malicious.com/callback', ['example.com'])).toBe(false);
      expect(Sep24Service.validateCallbackUrl('https://example.com.malicious.com/callback', ['example.com'])).toBe(false);
    });

    it('handles multiple allowed domains and case insensitivity', () => {
      const allowed = ['example.com', 'Wallet.org'];
      expect(Sep24Service.validateCallbackUrl('https://Example.COM/cb', allowed)).toBe(true);
      expect(Sep24Service.validateCallbackUrl('https://my.wallet.ORG/cb', allowed)).toBe(true);
      expect(Sep24Service.validateCallbackUrl('https://other.org/cb', allowed)).toBe(false);
    });
  });
});
