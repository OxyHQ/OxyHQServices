import { z } from 'zod';

// POST /security/activity/private-key-exported
export const logPrivateKeyExportedSchema = z.object({
  deviceId: z.string().trim().optional(),
});

// POST /security/activity/backup-created
export const logBackupCreatedSchema = z.object({
  deviceId: z.string().trim().optional(),
});

// POST /security/2fa/enable
export const enable2FASchema = z.object({
  token: z.string().trim().min(1),
});

// POST /security/2fa/disable
export const disable2FASchema = z.object({
  password: z.string().min(1),
  token: z.string().trim().optional(),
});

// POST /security/2fa/verify (no auth)
export const verify2FATokenSchema = z.object({
  identifier: z.string().trim().min(1),
  token: z.string().trim().optional(),
  backupCode: z.string().trim().optional(),
});

// POST /security/2fa/verify-login (no auth)
export const verify2FALoginSchema = z.object({
  loginToken: z.string().trim().min(1),
  token: z.string().trim().optional(),
  backupCode: z.string().trim().optional(),
  deviceName: z.string().trim().optional(),
  deviceFingerprint: z.string().trim().optional(),
});
