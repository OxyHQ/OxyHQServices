import { z } from 'zod';

// Params with :sessionId
export const sessionIdParams = z.object({
  sessionId: z.string().trim().min(1),
});

// POST /session/logout/:sessionId/:targetSessionId
export const logoutTargetParams = z.object({
  sessionId: z.string().trim().min(1),
  targetSessionId: z.string().trim().min(1),
});

// PUT /session/device/name/:sessionId
export const updateDeviceNameSchema = z.object({
  deviceName: z.string().trim().min(1),
});

// POST /session/users/batch
export const batchUsersSchema = z.object({
  sessionIds: z.array(z.string().trim().min(1)).min(1),
});

// Stricter params for the public (bearer-free) token-mint route: the sessionId
// IS the credential here, so we require it to be a well-formed UUID (sessionIds
// are minted via crypto.randomUUID()) to shrink the brute-force/enumeration
// surface. Mirrors the trust model of GET /session/validate/:sessionId.
export const sessionTokenMintParams = z.object({
  sessionId: z.string().trim().uuid(),
});
