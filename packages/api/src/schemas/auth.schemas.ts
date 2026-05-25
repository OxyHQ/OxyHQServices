import { z } from 'zod';

// POST /auth/signup
export const signupSchema = z.object({
  email: z.string().trim().email(),
  username: z.string().trim().min(3).max(30),
  password: z.string().min(8),
  name: z.object({
    first: z.string().trim().optional(),
    last: z.string().trim().optional(),
  }).optional(),
  deviceName: z.string().trim().optional(),
  deviceFingerprint: z.string().trim().optional(),
});

// POST /auth/login
export const loginSchema = z.object({
  identifier: z.string().trim().min(1).optional(),
  email: z.string().trim().optional(),
  username: z.string().trim().optional(),
  password: z.string().min(1),
  deviceName: z.string().trim().optional(),
  deviceFingerprint: z.string().trim().optional(),
});

// POST /auth/register (public key)
export const registerPublicKeySchema = z.object({
  publicKey: z.string().trim().min(1),
  signature: z.string().trim().min(1),
  timestamp: z.number(),
  email: z.string().trim().email().optional(),
  username: z.string().trim().min(3).max(30).optional(),
});

// POST /auth/challenge
export const challengeSchema = z.object({
  publicKey: z.string().trim().min(1),
});

// POST /auth/verify
export const verifyChallengeSchema = z.object({
  publicKey: z.string().trim().min(1),
  challenge: z.string().trim().min(1),
  signature: z.string().trim().min(1),
  timestamp: z.number(),
  deviceName: z.string().trim().optional(),
  deviceFingerprint: z.string().trim().optional(),
});

// POST /auth/recover/request
export const recoverRequestSchema = z.object({
  identifier: z.string().trim().min(1).optional(),
  email: z.string().trim().optional(),
  username: z.string().trim().optional(),
});

// POST /auth/recover/verify
export const recoverVerifySchema = z.object({
  identifier: z.string().trim().min(1).optional(),
  email: z.string().trim().optional(),
  username: z.string().trim().optional(),
  code: z.string().trim().min(1),
});

// POST /auth/recover/reset
export const recoverResetSchema = z.object({
  recoveryToken: z.string().trim().min(1),
  password: z.string().min(8),
});

// GET /auth/check-username/:username
export const checkUsernameParams = z.object({
  username: z.string().trim().min(3).max(30),
});

// GET /auth/check-email/:email
export const checkEmailParams = z.object({
  email: z.string().trim().email(),
});

// GET /auth/check-publickey/:publicKey
export const checkPublicKeyParams = z.object({
  publicKey: z.string().trim().min(1),
});

// GET /auth/user/:publicKey
export const getUserByPublicKeyParams = z.object({
  publicKey: z.string().trim().min(1),
});

// POST /auth/session/create
export const authSessionCreateSchema = z.object({
  sessionToken: z.string().trim().min(1),
  appId: z.string().trim().min(1),
  expiresAt: z.union([z.string(), z.number()]).optional(),
});

// GET /auth/session/status/:sessionToken
export const authSessionTokenParams = z.object({
  sessionToken: z.string().trim().min(1),
});

// POST /auth/session/authorize/:sessionToken
export const authorizeSessionBodySchema = z.object({
  deviceName: z.string().trim().optional(),
  deviceFingerprint: z.string().trim().optional(),
});

// POST /auth/service-token
export const serviceTokenSchema = z.object({
  apiKey: z.string().trim().min(1),
  apiSecret: z.string().trim().min(1),
});

// POST /auth/oauth/authorize
// Issued from the auth UI after the user clicks "Allow". Requires the user
// to be authenticated via Bearer token; the client passes the OAuth client
// id and the registered redirect URI to bind into a single-use code.
export const oauthAuthorizeSchema = z.object({
  clientId: z.string().trim().min(1),
  redirectUri: z.string().trim().url(),
  state: z.string().trim().min(1).max(512).optional(),
  /** PKCE — required for public clients (no clientSecret). */
  codeChallenge: z.string().trim().min(43).max(128).optional(),
  codeChallengeMethod: z.literal('S256').optional(),
  scope: z.string().trim().max(512).optional(),
});

// POST /auth/oauth/token
// Confidential clients pass clientSecret. Public clients pass codeVerifier.
export const oauthTokenSchema = z.object({
  code: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
  redirectUri: z.string().trim().url(),
  clientSecret: z.string().trim().min(1).optional(),
  codeVerifier: z.string().trim().min(43).max(128).optional(),
}).refine(
  (data) => Boolean(data.clientSecret) || Boolean(data.codeVerifier),
  { message: 'Either clientSecret (confidential client) or codeVerifier (PKCE) is required' }
);
