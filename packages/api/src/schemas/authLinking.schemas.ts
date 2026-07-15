import { z } from 'zod';

// POST /auth/link — only identity linking remains (passkeys register via the
// WebAuthn ceremony, not this route).
export const linkAuthMethodSchema = z.object({
  type: z.enum(['identity']),
  publicKey: z.string().trim().optional(),
  signature: z.string().trim().optional(),
  timestamp: z.number().optional(),
});

// DELETE /auth/link/:type
export const unlinkTypeParams = z.object({
  type: z.enum(['identity']),
});

// DELETE /auth/link/webauthn/:credentialID
export const unlinkWebauthnParams = z.object({
  credentialID: z.string().trim().min(1),
});
