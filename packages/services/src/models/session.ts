export interface ClientSession {
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  lastActive: string;
  // Only userId for identification, do not store username
  userId?: string;
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
} 