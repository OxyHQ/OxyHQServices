import { useEffect, useRef } from 'react';
import io, { type Socket } from 'socket.io-client';
import { toast } from '@oxyhq/bloom';
import { logger } from '@oxyhq/core';
import { createDebugLogger } from '@oxyhq/core';

const debug = createDebugLogger('SessionSocket');

/**
 * Server-emitted event types on the `session_update` channel.
 *
 * `session_removed`, `device_removed`, `sessions_removed` are the ONLY
 * events that may sign the user out. Anything else (e.g. `session_created`
 * fired right after a successful sign-in) MUST NOT trigger sign-out — see
 * the comment on the `default` branch below.
 */
type SessionEventType =
  | 'session_removed'
  | 'device_removed'
  | 'sessions_removed'
  | 'session_created'
  | 'session_update';

interface SessionUpdatePayload {
  type: SessionEventType | string;
  sessionId?: string;
  deviceId?: string;
  sessionIds?: string[];
}

interface UseSessionSocketProps {
  userId: string | null | undefined;
  activeSessionId: string | null | undefined;
  currentDeviceId: string | null | undefined;
  refreshSessions: () => Promise<void>;
  clearSessionState: () => Promise<void>;
  baseURL: string;
  getAccessToken: () => string | null;
  onRemoteSignOut?: () => void;
  onSessionRemoved?: (sessionId: string) => void;
}

export function useSessionSocket({
  userId,
  activeSessionId,
  currentDeviceId,
  refreshSessions,
  clearSessionState,
  baseURL,
  getAccessToken,
  onRemoteSignOut,
  onSessionRemoved,
}: UseSessionSocketProps) {
  const socketRef = useRef<Socket | null>(null);

  // Store callbacks in refs to avoid reconnecting when they change
  const refreshSessionsRef = useRef(refreshSessions);
  const clearSessionStateRef = useRef(clearSessionState);
  const onRemoteSignOutRef = useRef(onRemoteSignOut);
  const onSessionRemovedRef = useRef(onSessionRemoved);
  const activeSessionIdRef = useRef(activeSessionId);
  const currentDeviceIdRef = useRef(currentDeviceId);
  const getAccessTokenRef = useRef(getAccessToken);

  // Update refs when callbacks change
  useEffect(() => {
    refreshSessionsRef.current = refreshSessions;
    clearSessionStateRef.current = clearSessionState;
    onRemoteSignOutRef.current = onRemoteSignOut;
    onSessionRemovedRef.current = onSessionRemoved;
    activeSessionIdRef.current = activeSessionId;
    currentDeviceIdRef.current = currentDeviceId;
    getAccessTokenRef.current = getAccessToken;
  }, [refreshSessions, clearSessionState, onRemoteSignOut, onSessionRemoved, activeSessionId, currentDeviceId, getAccessToken]);

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

    const refreshSessionsSafe = () => {
      refreshSessionsRef.current().catch((error: unknown) => {
        // Refresh errors shouldn't break the socket handler. They happen
        // routinely when sessions are removed mid-fetch — log and move on.
        if (__DEV__) {
          logger.debug(
            'Failed to refresh sessions after session_update',
            { component: 'useSessionSocket' },
            error,
          );
        }
      });
    };

    const triggerLocalSignOut = async (toastMessage: string, errorContext: string) => {
      if (onRemoteSignOutRef.current) {
        onRemoteSignOutRef.current();
      } else {
        toast.info(toastMessage);
      }
      // Clear local state since the server has already removed the session.
      // Await so storage cleanup completes before any subsequent navigation.
      try {
        await clearSessionStateRef.current();
      } catch (error) {
        if (__DEV__) {
          logger.error(
            `Failed to clear session state after ${errorContext}`,
            error instanceof Error ? error : new Error(String(error)),
            { component: 'useSessionSocket' },
          );
        }
      }
    };

    const handleSessionUpdate = async (data: SessionUpdatePayload) => {
      debug.log('Received session_update:', data);

      const currentActiveSessionId = activeSessionIdRef.current;
      const currentDeviceIdValue = currentDeviceIdRef.current;

      // Strict whitelist. Every event type that may sign the user out must
      // appear in the switch. Anything unknown falls through to `default`,
      // which is intentionally a no-op for session lifecycle — it only logs
      // in dev. This guards against future server-side event additions
      // (e.g. `session_created`) accidentally triggering sign-out via a
      // "legacy fallback" branch.
      switch (data.type) {
        case 'session_removed': {
          if (data.sessionId && onSessionRemovedRef.current) {
            onSessionRemovedRef.current(data.sessionId);
          }
          if (data.sessionId && data.sessionId === currentActiveSessionId) {
            await triggerLocalSignOut('You have been signed out remotely.', 'session_removed');
          } else {
            refreshSessionsSafe();
          }
          break;
        }
        case 'device_removed': {
          if (data.sessionIds && onSessionRemovedRef.current) {
            for (const sessionId of data.sessionIds) {
              onSessionRemovedRef.current(sessionId);
            }
          }
          if (data.deviceId && currentDeviceIdValue && data.deviceId === currentDeviceIdValue) {
            await triggerLocalSignOut(
              'This device has been removed. You have been signed out.',
              'device_removed',
            );
          } else {
            refreshSessionsSafe();
          }
          break;
        }
        case 'sessions_removed': {
          if (data.sessionIds && onSessionRemovedRef.current) {
            for (const sessionId of data.sessionIds) {
              onSessionRemovedRef.current(sessionId);
            }
          }
          if (
            data.sessionIds &&
            currentActiveSessionId &&
            data.sessionIds.includes(currentActiveSessionId)
          ) {
            await triggerLocalSignOut('You have been signed out remotely.', 'sessions_removed');
          } else {
            refreshSessionsSafe();
          }
          break;
        }
        case 'session_created':
        case 'session_update': {
          // Lifecycle event for the current user. Just resync the sessions
          // list — never sign out. Historically this branch had a legacy
          // fallback that compared `data.sessionId === currentActiveSessionId`
          // and signed the user out if true, which was catastrophic: a
          // `session_created` event fired immediately after a successful
          // sign-in carries the user's NEW (now-active) session id, which
          // matched and triggered an instant remote sign-out toast on every
          // login. Whitelist explicitly; never fall through.
          refreshSessionsSafe();
          break;
        }
        default: {
          if (__DEV__) {
            logger.warn('Unknown session socket event type', {
              component: 'useSessionSocket',
              type: data.type,
            });
          }
          break;
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
