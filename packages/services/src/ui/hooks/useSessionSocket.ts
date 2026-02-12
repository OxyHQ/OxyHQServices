import { useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { toast } from '../../lib/sonner';
import { logger } from '@oxyhq/core';
import { createDebugLogger } from '@oxyhq/core';

const debug = createDebugLogger('SessionSocket');

interface UseSessionSocketProps {
  userId: string | null | undefined;
  activeSessionId: string | null | undefined;
  currentDeviceId: string | null | undefined;
  refreshSessions: () => Promise<void>;
  logout: () => Promise<void>;
  clearSessionState: () => Promise<void>;
  baseURL: string;
  getAccessToken: () => string | null;
  onRemoteSignOut?: () => void;
  onSessionRemoved?: (sessionId: string) => void;
}

export function useSessionSocket({ userId, activeSessionId, currentDeviceId, refreshSessions, logout, clearSessionState, baseURL, getAccessToken, onRemoteSignOut, onSessionRemoved }: UseSessionSocketProps) {
  const socketRef = useRef<any>(null);

  // Store callbacks in refs to avoid reconnecting when they change
  const refreshSessionsRef = useRef(refreshSessions);
  const logoutRef = useRef(logout);
  const clearSessionStateRef = useRef(clearSessionState);
  const onRemoteSignOutRef = useRef(onRemoteSignOut);
  const onSessionRemovedRef = useRef(onSessionRemoved);
  const activeSessionIdRef = useRef(activeSessionId);
  const currentDeviceIdRef = useRef(currentDeviceId);
  const getAccessTokenRef = useRef(getAccessToken);

  // Update refs when callbacks change
  useEffect(() => {
    refreshSessionsRef.current = refreshSessions;
    logoutRef.current = logout;
    clearSessionStateRef.current = clearSessionState;
    onRemoteSignOutRef.current = onRemoteSignOut;
    onSessionRemovedRef.current = onSessionRemoved;
    activeSessionIdRef.current = activeSessionId;
    currentDeviceIdRef.current = currentDeviceId;
    getAccessTokenRef.current = getAccessToken;
  }, [refreshSessions, logout, clearSessionState, onRemoteSignOut, onSessionRemoved, activeSessionId, currentDeviceId, getAccessToken]);

  useEffect(() => {
    if (!userId || !baseURL) {
      // Clean up if userId or baseURL becomes invalid
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Disconnect previous socket if switching users
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Connect with auth token; use callback so reconnections get a fresh token
    socketRef.current = io(baseURL, {
      transports: ['websocket'],
      auth: (cb) => {
        const token = getAccessTokenRef.current();
        cb({ token: token ?? '' });
      },
    });
    const socket = socketRef.current;

    // Server auto-joins the user to `user:<userId>` room on connection
    const handleConnect = () => {
      debug.log('Socket connected:', socket.id);
    };

    const handleSessionUpdate = async (data: {
      type: string;
      sessionId?: string;
      deviceId?: string;
      sessionIds?: string[]
    }) => {
      debug.log('Received session_update:', data);
      
      const currentActiveSessionId = activeSessionIdRef.current;
      const currentDeviceId = currentDeviceIdRef.current;
      
      // Handle different event types
      if (data.type === 'session_removed') {
        // Track removed session
        if (data.sessionId && onSessionRemovedRef.current) {
          onSessionRemovedRef.current(data.sessionId);
        }
        
        // If the removed sessionId matches the current activeSessionId, immediately clear state
        if (data.sessionId === currentActiveSessionId) {
          if (onRemoteSignOutRef.current) {
            onRemoteSignOutRef.current();
          } else {
            toast.info('You have been signed out remotely.');
          }
          // Use clearSessionState since session was already removed server-side
          // Await to ensure storage cleanup completes before continuing
          try {
            await clearSessionStateRef.current();
          } catch (error) {
            if (__DEV__) {
              logger.error('Failed to clear session state after session_removed', error instanceof Error ? error : new Error(String(error)), { component: 'useSessionSocket' });
            }
          }
        } else {
          // Otherwise, just refresh the sessions list (with error handling)
          refreshSessionsRef.current().catch((error) => {
            // Silently handle errors from refresh - they're expected if sessions were removed
            if (__DEV__) {
              logger.debug('Failed to refresh sessions after session_removed', { component: 'useSessionSocket' }, error as unknown);
            }
          });
        }
      } else if (data.type === 'device_removed') {
        // Track all removed sessions from this device
        if (data.sessionIds && onSessionRemovedRef.current) {
          for (const sessionId of data.sessionIds) {
            onSessionRemovedRef.current(sessionId);
          }
        }
        
        // If the removed deviceId matches the current device, immediately clear state
        if (data.deviceId && data.deviceId === currentDeviceId) {
          if (onRemoteSignOutRef.current) {
            onRemoteSignOutRef.current();
          } else {
            toast.info('This device has been removed. You have been signed out.');
          }
          // Use clearSessionState since sessions were already removed server-side
          // Await to ensure storage cleanup completes before continuing
          try {
            await clearSessionStateRef.current();
          } catch (error) {
            if (__DEV__) {
              logger.error('Failed to clear session state after device_removed', error instanceof Error ? error : new Error(String(error)), { component: 'useSessionSocket' });
            }
          }
        } else {
          // Otherwise, refresh sessions and device list (with error handling)
          refreshSessionsRef.current().catch((error) => {
            // Silently handle errors from refresh - they're expected if sessions were removed
            if (__DEV__) {
              logger.debug('Failed to refresh sessions after device_removed', { component: 'useSessionSocket' }, error as unknown);
            }
          });
        }
      } else if (data.type === 'sessions_removed') {
        // Track all removed sessions
        if (data.sessionIds && onSessionRemovedRef.current) {
          for (const sessionId of data.sessionIds) {
            onSessionRemovedRef.current(sessionId);
          }
        }
        
        // If the current activeSessionId is in the removed sessionIds list, immediately clear state
        if (data.sessionIds && currentActiveSessionId && data.sessionIds.includes(currentActiveSessionId)) {
          if (onRemoteSignOutRef.current) {
            onRemoteSignOutRef.current();
          } else {
            toast.info('You have been signed out remotely.');
          }
          // Use clearSessionState since sessions were already removed server-side
          // Await to ensure storage cleanup completes before continuing
          try {
            await clearSessionStateRef.current();
          } catch (error) {
            if (__DEV__) {
              logger.error('Failed to clear session state after sessions_removed', error instanceof Error ? error : new Error(String(error)), { component: 'useSessionSocket' });
            }
          }
        } else {
          // Otherwise, refresh sessions list (with error handling)
          refreshSessionsRef.current().catch((error) => {
            // Silently handle errors from refresh - they're expected if sessions were removed
            if (__DEV__) {
              logger.debug('Failed to refresh sessions after sessions_removed', { component: 'useSessionSocket' }, error as unknown);
            }
          });
        }
      } else {
        // For other event types (e.g., session_created), refresh sessions (with error handling)
        refreshSessionsRef.current().catch((error) => {
          // Log but don't throw - refresh errors shouldn't break the socket handler
          if (__DEV__) {
            logger.debug('Failed to refresh sessions after session_update', { component: 'useSessionSocket' }, error as unknown);
          }
        });
        
        // If the current session was logged out (legacy behavior), handle it specially
        if (data.sessionId === currentActiveSessionId) {
          if (onRemoteSignOutRef.current) {
            onRemoteSignOutRef.current();
          } else {
            toast.info('You have been signed out remotely.');
          }
          // Use clearSessionState since session was already removed server-side
          // Await to ensure storage cleanup completes before continuing
          try {
            await clearSessionStateRef.current();
          } catch (error) {
            debug.error('Failed to clear session state after session_update:', error);
          }
        }
      }
    };

    socket.on('connect', handleConnect);
    socket.on('session_update', handleSessionUpdate);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('session_update', handleSessionUpdate);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [userId, baseURL]); // Only depend on userId and baseURL - callbacks are in refs
} 