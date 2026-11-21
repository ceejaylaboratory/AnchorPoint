/**
 * WebAuthn helper for local, user-verifying biometric confirmation.
 *
 * The dashboard never registers credentials itself: an existing platform
 * authenticator (Touch ID / Face ID / Windows Hello) is discovered with a
 * discoverable-credential assertion. The returned assertion is deliberately
 * *not* treated as proof of identity on its own — a backend must verify the
 * signature against the registered credential before a transfer is signed.
 */

export const DEFAULT_WEBAUTHN_TIMEOUT_MS = 60_000;

export interface BiometricVerificationOptions {
  /** Explicit challenge; a fresh random one is generated when omitted. */
  challenge?: Uint8Array<ArrayBuffer>;
  /** Relying party id. Defaults to the current origin's host. */
  rpId?: string;
  timeoutMs?: number;
}

export interface BiometricVerificationResult {
  /** Base64url-encoded credential id from the assertion. */
  credentialId: string;
  /** Base64url-encoded authenticator data. */
  authenticatorData: string;
  /** Base64url-encoded client data JSON. */
  clientDataJSON: string;
  /** Base64url-encoded signature, for server-side verification. */
  signature: string;
  /** Whether the authenticator set the user-verified flag. */
  userVerified: boolean;
}

/** Base error so callers can distinguish our failures from DOM exceptions. */
export class WebAuthnError extends Error {
  /** Original DOM/credential error, kept for diagnostics. */
  public readonly reason?: unknown;

  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'WebAuthnError';
    this.reason = reason;
  }
}

/** The browser or device cannot perform a WebAuthn ceremony. */
export class WebAuthnUnavailableError extends WebAuthnError {
  constructor(message = 'WebAuthn is not available on this device.', cause?: unknown) {
    super(message, cause);
    this.name = 'WebAuthnUnavailableError';
  }
}

/** The user dismissed the prompt or the ceremony timed out. */
export class WebAuthnCancelledError extends WebAuthnError {
  constructor(message = 'Biometric verification was cancelled.', cause?: unknown) {
    super(message, cause);
    this.name = 'WebAuthnCancelledError';
  }
}

/** The authenticator failed, returned a malformed assertion, or did not verify the user. */
export class WebAuthnVerificationError extends WebAuthnError {
  constructor(message = 'Biometric verification failed.', cause?: unknown) {
    super(message, cause);
    this.name = 'WebAuthnVerificationError';
  }
}

const CANCELLATION_ERROR_NAMES = new Set(['NotAllowedError', 'AbortError']);

const isCancellationError = (error: unknown): boolean =>
  error instanceof DOMException
    ? CANCELLATION_ERROR_NAMES.has(error.name)
    : error instanceof Error && CANCELLATION_ERROR_NAMES.has(error.name);

/** True when the browser exposes the credential-get ceremony. */
export const isWebAuthnSupported = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.credentials?.get === 'function' &&
  typeof window !== 'undefined' &&
  typeof window.PublicKeyCredential !== 'undefined';

/**
 * Detects a user-verifying platform authenticator. Browsers that do not expose
 * the detection API are treated as capable so the ceremony is still attempted;
 * an actual failure falls through to the password / PIN confirmation path.
 */
export const isUserVerifyingAuthenticatorAvailable = async (): Promise<boolean> => {
  if (!isWebAuthnSupported()) return false;

  const detect = window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable;
  if (typeof detect !== 'function') return true;

  try {
    return await detect.call(window.PublicKeyCredential);
  } catch {
    return false;
  }
};

/** Uint8Array -> base64url, used for the assertion fields returned to callers. */
export const bytesToBase64Url = (source: ArrayBuffer | ArrayBufferView): string => {
  const bytes =
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Base64url -> Uint8Array, handy when a challenge comes from the server. */
export const base64UrlToBytes = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const createChallenge = (): Uint8Array<ArrayBuffer> => {
  const challenge = new Uint8Array(new ArrayBuffer(32));
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(challenge);
  }
  return challenge;
};

/**
 * Runs the WebAuthn get() ceremony and returns the assertion for the caller.
 * Cancellation and authentication failures are surfaced as typed errors so a
 * transfer can be stopped instead of silently continuing.
 */
export const requestBiometricVerification = async (
  options: BiometricVerificationOptions = {},
): Promise<BiometricVerificationResult> => {
  if (!isWebAuthnSupported()) {
    throw new WebAuthnUnavailableError();
  }

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: options.challenge ?? createChallenge(),
    timeout: options.timeoutMs ?? DEFAULT_WEBAUTHN_TIMEOUT_MS,
    userVerification: 'required',
    // Discoverable credentials let the platform pick the enrolled biometric
    // without the dashboard having to know a credential id.
    allowCredentials: [],
    ...(options.rpId ? { rpId: options.rpId } : {}),
  };

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({ publicKey });
  } catch (error) {
    if (isCancellationError(error)) {
      throw new WebAuthnCancelledError('Biometric verification was cancelled.', error);
    }
    throw new WebAuthnVerificationError('Biometric verification failed.', error);
  }

  if (!credential) {
    throw new WebAuthnCancelledError('Biometric verification was not completed.');
  }

  const assertion = credential as PublicKeyCredential;
  const response = assertion.response as AuthenticatorAssertionResponse;
  if (!response?.authenticatorData || !response.clientDataJSON || !response.signature) {
    throw new WebAuthnVerificationError('The authenticator returned an incomplete assertion.');
  }

  // Byte 32 of authenticatorData holds the flags; bit 0x04 is the UV flag.
  const authenticatorData = new Uint8Array(response.authenticatorData);
  const userVerified = ((authenticatorData[32] ?? 0) & 0x04) !== 0;
  if (!userVerified) {
    throw new WebAuthnVerificationError('The authenticator did not verify the user.');
  }

  return {
    credentialId: bytesToBase64Url(assertion.rawId ?? new ArrayBuffer(0)),
    authenticatorData: bytesToBase64Url(response.authenticatorData),
    clientDataJSON: bytesToBase64Url(response.clientDataJSON),
    signature: bytesToBase64Url(response.signature),
    userVerified,
  };
};
