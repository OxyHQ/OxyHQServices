import type { UserNameResponse } from '@oxyhq/contracts';

export interface ClientSession {
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  lastActive: string;
  userId?: string;
  isCurrent?: boolean;
  /**
   * The account's ordinal slot (0..N) within the device's account set
   * (`SessionAccount.authuser` in `@oxyhq/contracts`), projected from the
   * device-first `DeviceSessionState` — used purely for stable Google-style
   * account-chooser ordering, not for any token-refresh mechanism.
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
