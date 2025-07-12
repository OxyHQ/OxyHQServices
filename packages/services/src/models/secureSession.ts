export interface SecureClientSession {
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  lastActive: string;
  // Only userId for identification, do not store username
  userId?: string;
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
  deviceId: string;
  expiresAt: string;
  user: MinimalUserData;
}
