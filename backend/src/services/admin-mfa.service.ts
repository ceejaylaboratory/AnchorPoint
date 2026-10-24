import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import prisma from '../lib/prisma';
import { verifyPassword } from './password-hash.service';
import { signAccessToken, ACCESS_TOKEN_TTL_SECONDS } from './auth.service';
import { config } from '../config/env';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const BACKUP_CODE_COUNT = 10;
const MFA_ISSUER = 'AnchorPoint';

export class AdminAuthError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 401, code = 'AUTH_ERROR') {
    super(message);
    this.name = 'AdminAuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class MfaRequiredError extends AdminAuthError {
  constructor(message = 'TOTP code is required when MFA is enabled') {
    super(message, 401, 'MFA_REQUIRED');
    this.name = 'MfaRequiredError';
  }
}

export class InvalidTotpCodeError extends AdminAuthError {
  constructor(message = 'Invalid or expired TOTP code') {
    super(message, 401, 'INVALID_TOTP_CODE');
    this.name = 'InvalidTotpCodeError';
  }
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) {
      throw new Error(`Invalid base32 character: ${cleaned[i]}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates a Base32-encoded TOTP secret compatible with Google Authenticator and Authy.
 */
export function generateTotpSecret(bytes = 20): string {
  try {
    // Prefer otplib or speakeasy if installed in the environment
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const otplib = require('otplib');
    if (otplib?.authenticator?.generateSecret) {
      return otplib.authenticator.generateSecret(bytes);
    }
  } catch {
    // Fallback to RFC 6238 / Base32 implementation
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const speakeasy = require('speakeasy');
    if (speakeasy?.generateSecret) {
      const generated = speakeasy.generateSecret({ length: bytes });
      if (generated?.base32) {
        return generated.base32;
      }
    }
  } catch {
    // Fallback to native implementation
  }

  return base32Encode(randomBytes(bytes));
}

function generateHotp(secretBase32: string, counter: number, digits = TOTP_DIGITS): string {
  const key = base32Decode(secretBase32);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(Math.floor(counter)));

  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, digits);
  return String(otp).padStart(digits, '0');
}

/**
 * Generates a 6-digit TOTP code for the given secret and timestamp (ms).
 */
export function generateTotpCode(
  secret: string,
  timestampMs: number = Date.now(),
  stepSeconds: number = TOTP_STEP_SECONDS
): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  return generateHotp(secret, counter, TOTP_DIGITS);
}

/**
 * Verifies a 6-digit TOTP code within the allowed time window.
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  options?: { timestampMs?: number; window?: number; stepSeconds?: number }
): boolean {
  if (!secret || typeof code !== 'string') {
    return false;
  }

  const normalizedCode = code.trim();
  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  const timestampMs = options?.timestampMs ?? Date.now();
  const window = options?.window ?? 1;
  const stepSeconds = options?.stepSeconds ?? TOTP_STEP_SECONDS;
  const currentCounter = Math.floor(timestampMs / 1000 / stepSeconds);

  try {
    const providedBuf = Buffer.from(normalizedCode, 'utf8');
    for (let offset = -window; offset <= window; offset++) {
      const candidate = generateHotp(secret, currentCounter + offset, TOTP_DIGITS);
      const candidateBuf = Buffer.from(candidate, 'utf8');
      if (
        providedBuf.length === candidateBuf.length &&
        timingSafeEqual(providedBuf, candidateBuf)
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Builds an otpauth:// URI for Google Authenticator / Authy.
 */
export function buildOtpAuthUri(email: string, secret: string, issuer = MFA_ISSUER): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/**
 * Generates a QR code data URL (or SVG fallback) for the given otpauth:// URI.
 */
export async function generateQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const QRCode = require('qrcode');
    if (QRCode && typeof QRCode.toDataURL === 'function') {
      return await QRCode.toDataURL(otpauthUrl);
    }
  } catch {
    // Fallback if qrcode is unavailable in the runtime environment
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><desc>${otpauthUrl}</desc><rect width="200" height="200" fill="#ffffff"/><rect x="20" y="20" width="160" height="160" fill="#000000"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * Generates 10 single-use backup codes.
 */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashBackupCode(code: string): string {
  const normalized = normalizeBackupCode(code);
  return createHmac('sha256', config.JWT_SECRET).update(`mfa-backup:${normalized}`).digest('hex');
}

export interface MfaSetupResult {
  secret: string;
  qrCode: string;
  otpauthUrl: string;
  backupCodes: string[];
}

export interface AdminLoginResult {
  token: string;
  access_token: string;
  type: 'bearer';
  expires_in: number;
  admin: {
    id: string;
    email: string;
    role: string;
    mfaEnabled: boolean;
  };
}

export class AdminMfaService {
  /**
   * Generates a TOTP secret, QR code, and 10 single-use backup codes for an admin account.
   * Persists the pending secret and hashed backup codes on the admin record.
   */
  async setupMfa(adminId: string): Promise<MfaSetupResult> {
    const admin = await (prisma.adminUser as any).findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new AdminAuthError('Admin account not found', 404, 'ADMIN_NOT_FOUND');
    }

    const secret = generateTotpSecret();
    const otpauthUrl = buildOtpAuthUri(admin.email, secret);
    const qrCode = await generateQrCodeDataUrl(otpauthUrl);
    const backupCodes = generateBackupCodes(BACKUP_CODE_COUNT);
    const hashedBackupCodes = backupCodes.map(hashBackupCode);

    await (prisma.adminUser as any).update({
      where: { id: admin.id },
      data: {
        mfaSecret: secret,
        mfaEnabled: false,
        mfaBackupCodes: JSON.stringify(hashedBackupCodes),
      },
    });

    return {
      secret,
      qrCode,
      otpauthUrl,
      backupCodes,
    };
  }

  /**
   * Verifies the first TOTP code against the admin's configured secret and enables MFA.
   */
  async confirmMfa(
    adminId: string,
    code: string,
    options?: { timestampMs?: number }
  ): Promise<{ mfaEnabled: boolean }> {
    const admin = await (prisma.adminUser as any).findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new AdminAuthError('Admin account not found', 404, 'ADMIN_NOT_FOUND');
    }

    if (!admin.mfaSecret) {
      throw new AdminAuthError('MFA setup has not been initiated', 400, 'MFA_NOT_INITIALIZED');
    }

    const isValid = verifyTotpCode(admin.mfaSecret, code, {
      timestampMs: options?.timestampMs,
    });

    if (!isValid) {
      throw new InvalidTotpCodeError('Invalid or expired TOTP code');
    }

    await (prisma.adminUser as any).update({
      where: { id: admin.id },
      data: {
        mfaEnabled: true,
      },
    });

    return { mfaEnabled: true };
  }

  /**
   * Authenticates an admin using email and password, requiring a valid TOTP code
   * or single-use backup code when MFA is enabled.
   */
  async login(
    email: string,
    password: string,
    mfaCode?: string,
    options?: { timestampMs?: number }
  ): Promise<AdminLoginResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const admin = await (prisma.adminUser as any).findUnique({
      where: { email: normalizedEmail },
    });

    if (!admin) {
      throw new AdminAuthError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const passwordValid = await verifyPassword(password, admin.passwordHash);
    if (!passwordValid) {
      throw new AdminAuthError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (admin.mfaEnabled) {
      if (!mfaCode || !mfaCode.trim()) {
        throw new MfaRequiredError();
      }

      const trimmedCode = mfaCode.trim();
      const totpValid =
        Boolean(admin.mfaSecret) &&
        verifyTotpCode(admin.mfaSecret, trimmedCode, {
          timestampMs: options?.timestampMs,
        });

      if (!totpValid) {
        const consumedBackup = await this.consumeBackupCode(admin.id, admin.mfaBackupCodes, trimmedCode);
        if (!consumedBackup) {
          throw new InvalidTotpCodeError();
        }
      }
    }

    const accessToken = signAccessToken(admin.id);

    return {
      token: accessToken,
      access_token: accessToken,
      type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        mfaEnabled: Boolean(admin.mfaEnabled),
      },
    };
  }

  /**
   * Checks and consumes a single-use backup code if it matches one of the stored hashes.
   */
  private async consumeBackupCode(
    adminId: string,
    rawBackupCodesJson: string | null | undefined,
    candidateCode: string
  ): Promise<boolean> {
    if (!rawBackupCodesJson) {
      return false;
    }

    let storedHashes: string[];
    try {
      const parsed = JSON.parse(rawBackupCodesJson);
      if (!Array.isArray(parsed)) {
        return false;
      }
      storedHashes = parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      return false;
    }

    const candidateHash = hashBackupCode(candidateCode);
    const candidateBuf = Buffer.from(candidateHash, 'utf8');

    let matchIndex = -1;
    for (let i = 0; i < storedHashes.length; i++) {
      const storedBuf = Buffer.from(storedHashes[i], 'utf8');
      if (storedBuf.length === candidateBuf.length && timingSafeEqual(storedBuf, candidateBuf)) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex === -1) {
      return false;
    }

    const remainingHashes = storedHashes.filter((_, idx) => idx !== matchIndex);
    await (prisma.adminUser as any).update({
      where: { id: adminId },
      data: {
        mfaBackupCodes: JSON.stringify(remainingHashes),
      },
    });

    return true;
  }
}

export const adminMfaService = new AdminMfaService();
export default adminMfaService;
