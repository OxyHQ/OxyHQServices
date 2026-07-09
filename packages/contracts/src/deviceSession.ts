import { z } from 'zod';

export const sessionAccountSchema = z.object({
  accountId: z.string(),
  sessionId: z.string(),
  authuser: z.number().int().nonnegative(),
  operatedByUserId: z.string().optional(),
});

export const deviceSessionStateSchema = z.object({
  deviceId: z.string(),
  accounts: z.array(sessionAccountSchema),
  activeAccountId: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number(),
});

export const activeTokenSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string(),
});

export const deviceSessionSyncSchema = z.object({
  state: deviceSessionStateSchema,
  activeToken: activeTokenSchema.nullable(),
});

export type SessionAccount = z.infer<typeof sessionAccountSchema>;
export type DeviceSessionState = z.infer<typeof deviceSessionStateSchema>;
export type ActiveToken = z.infer<typeof activeTokenSchema>;
export type DeviceSessionSync = z.infer<typeof deviceSessionSyncSchema>;

/* -------------------------------------------------------------------------- */
/*  Device-secret token mint (phase 2c — zero-cookie transport)               */
/* -------------------------------------------------------------------------- */

/**
 * Request body for `POST /session/device/token` — the client presents the
 * `deviceId` it stored first-party plus the opaque `deviceSecret`. NO bearer:
 * possession of the secret IS the proof of device ownership. The server matches
 * `sha256(deviceSecret)` against the device's stored `secretHash` (constant-time)
 * and mints a short access token for the device's active account.
 */
export const deviceTokenMintRequestSchema = z.object({
  deviceId: z.string().min(1),
  deviceSecret: z.string().min(1),
});

/**
 * Wire shape of a successful `POST /session/device/token`: the freshly-minted
 * short access token for the active account, its expiry, the NEXT rotating
 * device secret the client must persist (rotation-in-use — the presented secret
 * stays valid for a short grace so multi-tab races don't lock out), and the
 * projected device-session state.
 */
export const deviceTokenMintResponseSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string(),
  nextDeviceSecret: z.string(),
  state: deviceSessionStateSchema,
});

export type DeviceTokenMintRequest = z.infer<typeof deviceTokenMintRequestSchema>;
export type DeviceTokenMintResponse = z.infer<typeof deviceTokenMintResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  Hub ticket — server-side cross-origin device credential sync               */
/* -------------------------------------------------------------------------- */

/** Request body for `POST /session/device/hub-ticket`. */
export const deviceHubTicketIssueRequestSchema = z.object({
  returnOrigin: z.string().min(1),
});

/** Response from `POST /session/device/hub-ticket`. */
export const deviceHubTicketIssueResponseSchema = z.object({
  ticket: z.string().min(1),
  expiresIn: z.number().int().positive(),
});

/** Request body for `POST /session/device/redeem-ticket`. */
export const deviceHubTicketRedeemRequestSchema = z.object({
  ticket: z.string().min(1),
  returnOrigin: z.string().min(1),
});

/** Response from `POST /session/device/redeem-ticket`. */
export const deviceHubTicketRedeemResponseSchema = z.object({
  deviceId: z.string().min(1),
  deviceSecret: z.string().min(1),
});

export type DeviceHubTicketIssueRequest = z.infer<typeof deviceHubTicketIssueRequestSchema>;
export type DeviceHubTicketIssueResponse = z.infer<typeof deviceHubTicketIssueResponseSchema>;
export type DeviceHubTicketRedeemRequest = z.infer<typeof deviceHubTicketRedeemRequestSchema>;
export type DeviceHubTicketRedeemResponse = z.infer<typeof deviceHubTicketRedeemResponseSchema>;
