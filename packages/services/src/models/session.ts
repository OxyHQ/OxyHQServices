/**
 * Client Session Model
 * 
 * IMPORTANT:
 * - userId: MongoDB ObjectId (24 hex characters), never publicKey
 * - Used for session management and user identification
 */
export interface ClientSession {
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  lastActive: string;
  userId?: string;  // MongoDB ObjectId - PRIMARY IDENTIFIER (never publicKey)
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
} 