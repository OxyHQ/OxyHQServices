import { z } from 'zod';

// POST /security/activity/private-key-exported
export const logPrivateKeyExportedSchema = z.object({
  deviceId: z.string().trim().optional(),
});

// POST /security/activity/backup-created
export const logBackupCreatedSchema = z.object({
  deviceId: z.string().trim().optional(),
});
