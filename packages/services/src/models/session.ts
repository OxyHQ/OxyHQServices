export interface ClientSession {
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  lastActive: string;
  userId?: string;
  isCurrent?: boolean;
}

export interface StorageKeys {
  sessions: string; // Array of ClientSession objects
  activeSessionId: string; // ID of currently active session
}

export interface MinimalUserData {
  id: string;
  username: string;
  avatar?: string; // file id
}

export interface SessionLoginResponse {
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  user: MinimalUserData;
  /** JWT access token for API authentication */
  accessToken?: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken?: string;
} 