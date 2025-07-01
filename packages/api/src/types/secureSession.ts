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
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string;
    avatar?: {
      id?: string;
      url?: string;
    };
    // Only non-sensitive data for initial display
  };
  message?: string;
}
