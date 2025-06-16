export interface SecureSessionData {
  sessionId: string;
  deviceId: string;
  lastActive: Date;
  expiresAt: Date;
}

export interface ClientSession {
  sessionId: string;
  deviceId: string;
  deviceName?: string;
  isActive: boolean;
}

export interface SessionAuthResponse {
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  user: {
    id: string;
    username: string;
    avatar?: string; // Changed from object to string to match User model
    // Only non-sensitive data for initial display
  };
}
