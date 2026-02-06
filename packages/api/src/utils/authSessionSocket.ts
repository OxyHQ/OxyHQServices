/**
 * Auth Session Socket Utilities
 * 
 * Handles real-time communication for cross-app authentication.
 * Used to notify third-party apps when a user authorizes via Oxy Accounts.
 */

import { Namespace } from 'socket.io';
import { logger } from './logger';

let authSessionNamespace: Namespace | null = null;

/**
 * Initialize the auth session namespace reference
 * Called from server.ts after Socket.IO is set up
 */
export function initAuthSessionNamespace(namespace: Namespace): void {
  authSessionNamespace = namespace;
}

/**
 * Emit an auth session update to connected clients
 * Used when a user authorizes, cancels, or the session expires
 */
export function emitAuthSessionUpdate(sessionToken: string, payload: {
  status: 'authorized' | 'cancelled' | 'expired';
  sessionId?: string;
  publicKey?: string;
  userId?: string;
  username?: string;
}): void {
  if (!authSessionNamespace) {
    logger.warn('Auth session namespace not initialized');
    return;
  }
  
  const room = `auth:${sessionToken}`;
  authSessionNamespace.to(room).emit('auth_update', payload);
}
