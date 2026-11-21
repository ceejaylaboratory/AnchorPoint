import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WebAuthnCancelledError,
  WebAuthnUnavailableError,
  WebAuthnVerificationError,
  DEFAULT_WEBAUTHN_TIMEOUT_MS,
  base64UrlToBytes,
  bytesToBase64Url,
  isUserVerifyingAuthenticatorAvailable,
  isWebAuthnSupported,
  requestBiometricVerification,
} from './webauthn';

type GetCredential = (options: CredentialRequestOptions) => Promise<Credential | null>;

const stubCredentials = (get: GetCredential) => {
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get } });
};

const stubPlatformAuthenticator = (available: boolean | undefined) => {
  if (available === undefined) {
    Reflect.deleteProperty(window, 'PublicKeyCredential');
    return;
  }
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(available),
    },
  });
};

/** Assertion with the user-verified flag set in byte 32 of authenticatorData. */
const makeAssertion = (userVerified = true): PublicKeyCredential => {
  const authenticatorData = new Uint8Array(37);
  if (userVerified) authenticatorData[32] = 0x04;

  return {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    response: {
      authenticatorData: authenticatorData.buffer,
      clientDataJSON: new Uint8Array([123, 125]).buffer,
      signature: new Uint8Array([9, 8, 7]).buffer,
    },
  } as unknown as PublicKeyCredential;
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'credentials');
  Reflect.deleteProperty(window, 'PublicKeyCredential');
  vi.restoreAllMocks();
});

describe('WebAuthn capability detection', () => {
  it('reports unsupported when the browser has no credential API', () => {
    stubPlatformAuthenticator(undefined);
    stubCredentials(vi.fn());

    expect(isWebAuthnSupported()).toBe(false);
  });

  it('reports supported when credentials.get and PublicKeyCredential exist', () => {
    stubPlatformAuthenticator(true);
    stubCredentials(vi.fn());

    expect(isWebAuthnSupported()).toBe(true);
  });

  it('detects a user-verifying platform authenticator', async () => {
    stubCredentials(vi.fn());
    stubPlatformAuthenticator(true);
    expect(await isUserVerifyingAuthenticatorAvailable()).toBe(true);

    stubPlatformAuthenticator(false);
    expect(await isUserVerifyingAuthenticatorAvailable()).toBe(false);
  });

  it('attempts the ceremony when the detector API is unavailable', async () => {
    stubCredentials(vi.fn());
    stubPlatformAuthenticator(undefined);
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: {} });

    expect(await isUserVerifyingAuthenticatorAvailable()).toBe(true);
  });
});

describe('requestBiometricVerification', () => {
  it('runs a discoverable credential assertion requiring user verification', async () => {
    stubPlatformAuthenticator(true);
    const get = vi.fn().mockResolvedValue(makeAssertion());
    stubCredentials(get);
    const challenge = new Uint8Array([4, 5, 6]);

    const result = await requestBiometricVerification({
      challenge,
      rpId: 'anchor.example',
      timeoutMs: 5_000,
    });

    expect(get).toHaveBeenCalledTimes(1);
    const { publicKey } = get.mock.calls[0][0] as { publicKey: PublicKeyCredentialRequestOptions };
    expect(publicKey.challenge).toEqual(challenge);
    expect(publicKey.userVerification).toBe('required');
    expect(publicKey.allowCredentials).toEqual([]);
    expect(publicKey.rpId).toBe('anchor.example');
    expect(publicKey.timeout).toBe(5_000);

    expect(result.userVerified).toBe(true);
    expect(result.credentialId).toBe(bytesToBase64Url(new Uint8Array([1, 2, 3]).buffer));
    expect(bytesToBase64Url(base64UrlToBytes(result.signature))).toBe(result.signature);
  });

  it('uses a fresh challenge and default timeout when none are provided', async () => {
    stubPlatformAuthenticator(true);
    const get = vi.fn().mockResolvedValue(makeAssertion());
    stubCredentials(get);

    await requestBiometricVerification();

    const { publicKey } = get.mock.calls[0][0] as { publicKey: PublicKeyCredentialRequestOptions };
    expect((publicKey.challenge as Uint8Array).byteLength).toBe(32);
    expect(publicKey.timeout).toBe(DEFAULT_WEBAUTHN_TIMEOUT_MS);
    expect(publicKey.rpId).toBeUndefined();
  });

  it('rejects with a cancellation error when the user dismisses the prompt', async () => {
    stubPlatformAuthenticator(true);
    stubCredentials(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));

    await expect(requestBiometricVerification()).rejects.toBeInstanceOf(WebAuthnCancelledError);
  });

  it('rejects with a cancellation error when no assertion is returned', async () => {
    stubPlatformAuthenticator(true);
    stubCredentials(vi.fn().mockResolvedValue(null));

    await expect(requestBiometricVerification()).rejects.toBeInstanceOf(WebAuthnCancelledError);
  });

  it('rejects with a verification error when the authenticator fails', async () => {
    stubPlatformAuthenticator(true);
    stubCredentials(vi.fn().mockRejectedValue(new Error('authenticator unavailable')));

    await expect(requestBiometricVerification()).rejects.toBeInstanceOf(WebAuthnVerificationError);
  });

  it('rejects an assertion without the user-verified flag', async () => {
    stubPlatformAuthenticator(true);
    stubCredentials(vi.fn().mockResolvedValue(makeAssertion(false)));

    await expect(requestBiometricVerification()).rejects.toBeInstanceOf(WebAuthnVerificationError);
  });

  it('rejects before calling the browser when WebAuthn is unavailable', async () => {
    stubPlatformAuthenticator(undefined);
    const get = vi.fn();
    stubCredentials(get);

    await expect(requestBiometricVerification()).rejects.toBeInstanceOf(WebAuthnUnavailableError);
    expect(get).not.toHaveBeenCalled();
  });

  it('round-trips bytes through base64url', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    expect(base64UrlToBytes(bytesToBase64Url(bytes.buffer))).toEqual(bytes);
  });
});
