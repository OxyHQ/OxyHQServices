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

/* -------------------------------------------------------------------------- */
/*  Instant cross-app session sync (token-free socket signal)                 */
/* -------------------------------------------------------------------------- */

/**
 * Name of the token-free Socket.IO event emitted to room `user:<userId>` on
 * every DeviceSession mutation that changes what is signed in for that user.
 *
 * This is a pure SIGNAL — it carries NO access token, NO deviceSecret and NO
 * account bodies. A client that receives it re-fetches its authenticated
 * session/account state (`GET /session/device/state`, `GET /accounts`). Unlike
 * `session_state` (scoped to `device:<deviceId>`, i.e. a single origin), this
 * reaches ALL of a user's connected sockets across their devices/origins so
 * every Oxy app reflects an add / switch / signout instantly.
 */
export const SESSION_ACCOUNTS_CHANGED_EVENT = 'session_accounts_changed';

/**
 * Why the signed-in set changed:
 *  - `login`   — a brand-new session was minted for the user (QR / cross-app authorize)
 *  - `add`     — an account was registered onto a device set
 *  - `switch`  — the active account on a device changed
 *  - `signout` — one or all accounts were signed out of a device
 *  - `revoke`  — a dead/revoked account was healed out of a device set
 */
export const sessionAccountsChangedReasonSchema = z.enum([
  'login',
  'add',
  'switch',
  'signout',
  'revoke',
]);

/**
 * Payload of {@link SESSION_ACCOUNTS_CHANGED_EVENT}. `revision` is the mutated
 * DeviceSession revision for device-scoped reasons (`add`/`switch`/`signout`/
 * `revoke`); for `login` (no device mutation at emit time) it is `0`. The
 * payload is deliberately minimal and secret-free — the client refetches.
 */
export const sessionAccountsChangedEventSchema = z.object({
  userId: z.string(),
  revision: z.number().int().nonnegative(),
  reason: sessionAccountsChangedReasonSchema,
});

export type SessionAccountsChangedReason = z.infer<typeof sessionAccountsChangedReasonSchema>;
export type SessionAccountsChangedEvent = z.infer<typeof sessionAccountsChangedEventSchema>;
