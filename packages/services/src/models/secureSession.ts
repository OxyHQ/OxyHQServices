export interface SecureClientSession {
  sessionId: string;
  deviceId?: string;
  expiresAt?: string;
  lastActive: string;
  // Add user info for efficient duplicate detection
  userId?: string;
  username?: string;
}

export interface SecureStorageKeys {
  sessions: string; // Array of SecureClientSession objects
  activeSessionId: string; // ID of currently active session
}

export interface MinimalUserData {
  id: string;
  username: string;
  avatar?: {
    id?: string;
    url?: string;
  };
}

export interface SecureLoginResponse {
  sessionId: string;
  deviceId?: string;
  expiresAt?: string;
  accessToken: string;
  refreshToken: string;
  user: MinimalUserData;
  message?: string;
}
