import { URL } from 'url';

export class Sep24Service {
  /**
   * Validates a callback or redirect URL against a whitelist of allowed domains.
   *
   * @param url The URL to validate.
   * @param allowedDomains Array of allowed hostnames (e.g., ['example.com']).
   * @returns boolean true if valid, false if invalid or not allowed.
   */
  public static validateCallbackUrl(url: string, allowedDomains: string[]): boolean {
    if (!url) return false;

    try {
      const parsedUrl = new URL(url);

      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        return false;
      }

      if (!allowedDomains || allowedDomains.length === 0) {
        return true; // If no whitelist is defined, allow (or you can restrict default)
      }

      const hostname = parsedUrl.hostname.toLowerCase();

      return allowedDomains.some((domain) => {
        const d = domain.trim().toLowerCase();
        if (!d) return false;
        return hostname === d || hostname.endsWith(`.${d}`);
      });
    } catch {
      return false; // Invalid URL format
    }
  }
}
