import type { UserNameResponse } from '@oxyhq/contracts';

export interface ClientSession {
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  lastActive: string;
  userId?: string;
  isCurrent?: boolean;
  /**
   * Web-only: the device-local refresh-cookie slot index (0..N) that backs
   * this session. Populated from `POST /auth/refresh-all` and from login /
   * signup / fedcm-exchange responses. Required for per-session web token
   * refresh via `refreshTokenViaCookie({ authuser })` without a bearer token.
   * Absent on native (RN uses the bearer-protected session id directly).
   */
  authuser?: number;
}

export interface StorageKeys {
  sessions: string; // Array of ClientSession objects
  activeSessionId: string; // ID of currently active session
}

export interface MinimalUserData {
  id: string;
  username: string;
  name: UserNameResponse;
  avatar?: string; // file id
}

export interface SessionLoginResponse {
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  user: MinimalUserData;
  /** JWT access token for API authentication */
  accessToken?: string;
}
