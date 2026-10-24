import { Request, Response } from 'express';
import { AdminRequest } from '../middleware/auth.middleware';
import {
  AdminMfaService,
  AdminAuthError,
  MfaRequiredError,
  InvalidTotpCodeError,
  adminMfaService as defaultAdminMfaService,
} from '../../services/admin-mfa.service';
import adminAuditService, { getAuditActor } from '../../services/admin-audit.service';
import logger from '../../utils/logger';

export class AdminController {
  constructor(private readonly mfaService: AdminMfaService = defaultAdminMfaService) {}

  /**
   * POST /api/admin/mfa/setup
   * Generates a new TOTP secret, QR code, and 10 single-use backup codes for the authenticated admin.
   */
  setupMfa = async (req: AdminRequest, res: Response): Promise<Response> => {
    const adminId = req.admin?.id ?? (req.body?.adminId as string | undefined);
    if (!adminId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required.',
      });
    }

    try {
      const result = await this.mfaService.setupMfa(adminId);

      await adminAuditService.recordConfigChange({
        action: 'ADMIN_MFA_SETUP',
        actor: getAuditActor(req),
        targetEntity: `admin:${adminId}`,
      });

      return res.status(200).json({
        status: 'success',
        secret: result.secret,
        qrCode: result.qrCode,
        otpauthUrl: result.otpauthUrl,
        backupCodes: result.backupCodes,
        data: result,
      });
    } catch (error: unknown) {
      if (error instanceof AdminAuthError) {
        return res.status(error.statusCode).json({
          status: 'error',
          code: error.code,
          message: error.message,
        });
      }

      logger.error('Failed to setup admin MFA', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        status: 'error',
        message: 'Unable to setup MFA.',
      });
    }
  };

  /**
   * POST /api/admin/mfa/confirm
   * Verifies the first TOTP code and enables MFA on the authenticated admin account.
   */
  confirmMfa = async (req: AdminRequest, res: Response): Promise<Response> => {
    const adminId = req.admin?.id ?? (req.body?.adminId as string | undefined);
    if (!adminId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required.',
      });
    }

    const code = (req.body?.code ?? req.body?.totpCode ?? req.body?.token) as string | undefined;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'TOTP code is required',
      });
    }

    try {
      const result = await this.mfaService.confirmMfa(adminId, code);

      await adminAuditService.recordConfigChange({
        action: 'ADMIN_MFA_CONFIRM',
        actor: getAuditActor(req),
        targetEntity: `admin:${adminId}`,
        after: { mfaEnabled: true },
      });

      return res.status(200).json({
        status: 'success',
        message: 'MFA enabled successfully.',
        mfaEnabled: result.mfaEnabled,
        data: result,
      });
    } catch (error: unknown) {
      if (error instanceof InvalidTotpCodeError) {
        return res.status(400).json({
          status: 'error',
          code: error.code,
          message: error.message,
        });
      }

      if (error instanceof AdminAuthError) {
        return res.status(error.statusCode).json({
          status: 'error',
          code: error.code,
          message: error.message,
        });
      }

      logger.error('Failed to confirm admin MFA', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        status: 'error',
        message: 'Unable to confirm MFA.',
      });
    }
  };

  /**
   * POST /api/admin/login
   * Authenticates an admin with email + password, and requires a valid TOTP or backup code when MFA is enabled.
   */
  login = async (req: Request, res: Response): Promise<Response> => {
    const { email, password, totpCode, code, token, backupCode } = req.body ?? {};

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'Email and password are required.',
      });
    }

    const suppliedMfaCode = (totpCode ?? code ?? token ?? backupCode) as string | undefined;

    try {
      const result = await this.mfaService.login(email, password, suppliedMfaCode);

      await adminAuditService.recordConfigChange({
        action: 'ADMIN_LOGIN',
        actor: {
          ...getAuditActor(req),
          id: result.admin.id,
          email: result.admin.email,
        },
        targetEntity: `admin:${result.admin.id}`,
      });

      return res.status(200).json({
        status: 'success',
        token: result.token,
        access_token: result.access_token,
        type: result.type,
        expires_in: result.expires_in,
        admin: result.admin,
        data: result,
      });
    } catch (error: unknown) {
      if (error instanceof MfaRequiredError) {
        return res.status(401).json({
          status: 'error',
          code: error.code,
          mfaRequired: true,
          message: error.message,
        });
      }

      if (error instanceof InvalidTotpCodeError) {
        return res.status(401).json({
          status: 'error',
          code: error.code,
          message: error.message,
        });
      }

      if (error instanceof AdminAuthError) {
        return res.status(error.statusCode).json({
          status: 'error',
          code: error.code,
          message: error.message,
        });
      }

      logger.error('Admin login failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        status: 'error',
        message: 'Unable to process login.',
      });
    }
  };
}

export const adminController = new AdminController();

export const setupAdminMfa = adminController.setupMfa;
export const confirmAdminMfa = adminController.confirmMfa;
export const loginAdmin = adminController.login;

export default adminController;
