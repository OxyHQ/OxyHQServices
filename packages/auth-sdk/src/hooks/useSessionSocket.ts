import { useEffect, useRef, useMemo } from 'react';
import io from 'socket.io-client';
import { toast } from 'sonner';
import { logger } from '@oxyhq/core';
import { createDebugLogger } from '@oxyhq/core';
import { useWebOxy } from '../WebOxyProvider';
import { useQueryClient } from '@tanstack/react-query';
import { useSessions } from './queries/useServicesQueries';
import { invalidateSessionQueries } from './queries/queryKeys';

const debug = createDebugLogger('SessionSocket');

export interface UseSessionSocketOptions {
  onRemoteSignOut?: () => void;
  onSessionRemoved?: (sessionId: string) => void;
}

export function useSessionSocket(options?: UseSessionSocketOptions) {
  const { user, activeSessionId, oxyServices, signOut, clearSessionState } = useWebOxy();
  const queryClient = useQueryClient();

  const userId = user?.id ?? null;
  const baseURL = oxyServices.getBaseURL();

  // Derive currentDeviceId from sessions query
  const { data: sessions } = useSessions(userId ?? undefined);
  const currentDeviceId = useMemo(() => {
    if (!sessions || !activeSessionId) return null;
    const active = sessions.find((s) => s.sessionId === activeSessionId);
    return active?.deviceId ?? null;
  }, [sessions, activeSessionId]);

  const socketRef = useRef<any>(null);

  // Store callbacks and values in refs to avoid reconnecting when they change
  const clearSessionStateRef = useRef(clearSessionState);
  const onRemoteSignOutRef = useRef(options?.onRemoteSignOut);
  const onSessionRemovedRef = useRef(options?.onSessionRemoved);
  const activeSessionIdRef = useRef(activeSessionId);
  const currentDeviceIdRef = useRef(currentDeviceId);
  const queryClientRef = useRef(queryClient);

  // Update refs when values change
  useEffect(() => {
    clearSessionStateRef.current = clearSessionState;
    onRemoteSignOutRef.current = options?.onRemoteSignOut;
    onSessionRemovedRef.current = options?.onSessionRemoved;
    activeSessionIdRef.current = activeSessionId;
    currentDeviceIdRef.current = currentDeviceId;
    queryClientRef.current = queryClient;
  }, [clearSessionState, options?.onRemoteSignOut, options?.onSessionRemoved, activeSessionId, currentDeviceId, queryClient]);

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
      auth: (cb: (data: { token: string }) => void) => {
        const token = oxyServices.getAccessToken();
        cb({ token: token ?? '' });
      },
    });
    const socket = socketRef.current;

    // Server auto-joins the user to `user:<userId>` room on connection
    const handleConnect = () => {
      debug.log('Socket connected:', socket.id);
    };

    const refreshSessions = () => {
      invalidateSessionQueries(queryClientRef.current);
      return Promise.resolve();
    };

    const handleSessionUpdate = async (data: {
      type: string;
      sessionId?: string;
      deviceId?: string;
      sessionIds?: string[]
    }) => {
      debug.log('Received session_update:', data);

      const currentActiveSessionId = activeSessionIdRef.current;
      const deviceId = currentDeviceIdRef.current;

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
          try {
            await clearSessionStateRef.current();
          } catch (error) {
            if (__DEV__) {
              logger.error('Failed to clear session state after session_removed', error instanceof Error ? error : new Error(String(error)), { component: 'useSessionSocket' });
            }
          }
        } else {
          refreshSessions();
        }
      } else if (data.type === 'device_removed') {
        // Track all removed sessions from this device
        if (data.sessionIds && onSessionRemovedRef.current) {
          for (const sessionId of data.sessionIds) {
            onSessionRemovedRef.current(sessionId);
          }
        }

        // If the removed deviceId matches the current device, immediately clear state
        if (data.deviceId && data.deviceId === deviceId) {
          if (onRemoteSignOutRef.current) {
            onRemoteSignOutRef.current();
          } else {
            toast.info('This device has been removed. You have been signed out.');
          }
          try {
            await clearSessionStateRef.current();
          } catch (error) {
            if (__DEV__) {
              logger.error('Failed to clear session state after device_removed', error instanceof Error ? error : new Error(String(error)), { component: 'useSessionSocket' });
            }
          }
        } else {
          refreshSessions();
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
          try {
            await clearSessionStateRef.current();
          } catch (error) {
            if (__DEV__) {
              logger.error('Failed to clear session state after sessions_removed', error instanceof Error ? error : new Error(String(error)), { component: 'useSessionSocket' });
            }
          }
        } else {
          refreshSessions();
        }
      } else {
        // For other event types (e.g., session_created), refresh sessions
        refreshSessions();

        // If the current session was logged out (legacy behavior), handle it specially
        if (data.sessionId === currentActiveSessionId) {
          if (onRemoteSignOutRef.current) {
            onRemoteSignOutRef.current();
          } else {
            toast.info('You have been signed out remotely.');
          }
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
