/**
 * SessionService - Single Source of Truth for Session Management
 * 
 * Handles all session operations: creation, validation, refresh, invalidation.
 * Manages active session state and provides session data to other services.
 * 
 * Architecture:
 * - Single source of truth for session operations
 * - Handles both online and offline sessions
 * - Integrates with TokenService for token management
 * - userId is always MongoDB ObjectId, never publicKey
 */

import type { OxyServices } from '../OxyServices';
import { tokenService } from './TokenService';
import type { ClientSession, SessionLoginResponse } from '../../models/session';
import type { User } from '../../models/interfaces';

export interface Session {
  sessionId: string;
  deviceId: string;
  userId: string;  // MongoDB ObjectId - PRIMARY IDENTIFIER
  expiresAt: string;
  lastActive: string;
  isCurrent: boolean;
  isOffline?: boolean;
}

/**
 * SessionService - Singleton pattern for global session management
 */
class SessionService {
  private static instance: SessionService;
  private oxyServices: OxyServices | null = null;
  private activeSession: Session | null = null;
  private sessions: Session[] = [];

  private constructor() {}

  static getInstance(): SessionService {
    if (!SessionService.instance) {
      SessionService.instance = new SessionService();
    }
    return SessionService.instance;
  }

  /**
   * Initialize SessionService with OxyServices instance
   */
  initialize(oxyServices: OxyServices): void {
    this.oxyServices = oxyServices;
  }

  /**
   * Get active session
   */
  getActiveSession(): Session | null {
    return this.activeSession;
  }

  /**
   * Get all sessions
   */
  getAllSessions(): Session[] {
    return [...this.sessions];
  }

  /**
   * Create a new session (sign in)
   * @param publicKey - User's public key for authentication
   * @returns User object and session data
   */
  async createSession(publicKey: string): Promise<{ user: User; session: Session }> {
    if (!this.oxyServices) {
      throw new Error('SessionService not initialized with OxyServices');
    }

    // This will be implemented by delegating to existing sign-in logic
    // For now, this is a placeholder that shows the interface
    throw new Error('SessionService.createSession not yet implemented - use existing signIn flow');
  }

  /**
   * Refresh current session
   */
  async refreshSession(): Promise<Session> {
    if (!this.activeSession) {
      throw new Error('No active session to refresh');
    }

    // Refresh token first
    await tokenService.refreshTokenIfNeeded();

    // Then refresh session data from server
    // Implementation will be added
    return this.activeSession;
  }

  /**
   * Validate current session
   */
  async validateSession(): Promise<boolean> {
    if (!this.activeSession) {
      return false;
    }

    // Check if session expired
    if (new Date(this.activeSession.expiresAt) < new Date()) {
      return false;
    }

    // Check if token is valid
    const token = tokenService.getAccessToken();
    if (!token) {
      return false;
    }

    // Additional validation can be added here
    return true;
  }

  /**
   * Invalidate current session (sign out)
   */
  async invalidateSession(): Promise<void> {
    if (!this.activeSession || !this.oxyServices) {
      return;
    }

    try {
      // Call API to invalidate session on server
      await this.oxyServices.makeRequest('POST', `/api/session/${this.activeSession.sessionId}/logout`, undefined, { cache: false });
    } catch (error) {
      // Continue with local cleanup even if API call fails
      console.warn('Failed to invalidate session on server:', error);
    }

    // Clear tokens
    tokenService.clearTokens();

    // Clear active session
    this.activeSession = null;
    this.sessions = this.sessions.filter(s => s.sessionId !== this.activeSession?.sessionId);
  }

  /**
   * Set active session (internal use)
   */
  setActiveSession(session: Session): void {
    this.activeSession = session;
    
    // Update sessions list
    const existingIndex = this.sessions.findIndex(s => s.sessionId === session.sessionId);
    if (existingIndex >= 0) {
      this.sessions[existingIndex] = session;
    } else {
      this.sessions.push(session);
    }
  }

  /**
   * Clear all sessions (logout all)
   */
  clearAllSessions(): void {
    this.activeSession = null;
    this.sessions = [];
    tokenService.clearTokens();
  }
}

// Export singleton instance
export const sessionService = SessionService.getInstance();

