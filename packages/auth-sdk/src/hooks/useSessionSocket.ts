import { useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { logger } from '@oxyhq/core';
import { createDebugLogger } from '@oxyhq/core';
import { useWebOxy } from '../WebOxyProvider';
import { useQueryClient } from '@tanstack/react-query';
import { useSessions } from './queries/useServicesQueries';
import { invalidateSessionQueries } from './queries/queryKeys';

const debug = createDebugLogger('SessionSocket');

/** localStorage key used by AuthManager for persisting access tokens. */
const LS_ACCESS_TOKEN_KEY = 'oxy_access_token';

/** Delay before retrying socket connection after an auth failure (ms). */
const AUTH_RETRY_DELAY_MS = 2000;

/** Maximum number of consecutive auth-failure retries. */
const MAX_AUTH_RETRIES = 3;

/**
 * Read the access token from localStorage directly.
 * Used as a fallback when the in-memory token is empty (e.g., during a
 * cross-tab token refresh race).
 */
function readTokenFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LS_ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

type SocketIOFactory = (uri: string, opts?: Record<string, unknown>) => unknown;

let _io: SocketIOFactory | null = null;
let _ioLoadAttempted = false;

async function getSocketIO(): Promise<SocketIOFactory | null> {
  if (_io) return _io;
  if (_ioLoadAttempted) return null;
  _ioLoadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: any = await import('socket.io-client');
    _io = (mod.io ?? mod.default) as SocketIOFactory;
    return _io;
  } catch {
    debug.warn('socket.io-client is not installed. useSessionSocket will be disabled. Install it with: bun add socket.io-client');
    return null;
  }
}

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

    let cancelled = false;
    let authRetryCount = 0;
    let authRetryTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Resolve the best available access token.
     * Prefers the in-memory token from OxyServices; falls back to
     * localStorage which may have been updated by another tab.
     */
    const resolveToken = (): string | null => {
      return oxyServices.getAccessToken() || readTokenFromStorage();
    };

    getSocketIO().then((ioFn) => {
      if (cancelled || !ioFn) return;

      // Connect with auth token; use callback so reconnections get a fresh token.
      // If no token is available at all, we skip the initial connect and let
      // the storage listener or retry logic connect when a token appears.
      const token = resolveToken();
      socketRef.current = ioFn(baseURL, {
        transports: ['websocket'],
        autoConnect: !!token, // don't auto-connect when there is no token
        auth: (cb: (data: { token: string }) => void) => {
          const resolved = resolveToken();
          if (!resolved) {
            // No token available -- disconnect gracefully instead of sending
            // an empty string that the server will reject.
            debug.warn('No access token available for socket auth; disconnecting.');
            if (socketRef.current) {
              socketRef.current.disconnect();
            }
            return;
          }
          cb({ token: resolved });
        },
      });
      const socket = socketRef.current;

      // Server auto-joins the user to `user:<userId>` room on connection
      const handleConnect = () => {
        debug.log('Socket connected:', socket.id);
        // Successful connection resets the auth retry counter.
        authRetryCount = 0;
      };

      /**
       * Handle socket disconnection. When the disconnect reason indicates an
       * auth failure (server rejected the token), schedule a short retry so
       * that an in-progress token refresh can complete before the next attempt.
       */
      const handleDisconnect = (reason: string) => {
        debug.log('Socket disconnected:', reason);
        // "io server disconnect" = server forcibly closed the connection (auth failure).
        // "transport error" can also happen when the auth callback aborted.
        if (
          (reason === 'io server disconnect' || reason === 'transport error') &&
          authRetryCount < MAX_AUTH_RETRIES &&
          !cancelled
        ) {
          authRetryCount++;
          debug.log(
            `Auth-related disconnect; scheduling retry ${authRetryCount}/${MAX_AUTH_RETRIES} in ${AUTH_RETRY_DELAY_MS}ms`
          );
          authRetryTimer = setTimeout(() => {
            if (cancelled) return;
            const retryToken = resolveToken();
            if (retryToken && socketRef.current) {
              debug.log('Retrying socket connection with refreshed token');
              socketRef.current.connect();
            }
          }, AUTH_RETRY_DELAY_MS);
        }
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
              if (process.env.NODE_ENV !== 'production') {
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
              if (process.env.NODE_ENV !== 'production') {
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
              if (process.env.NODE_ENV !== 'production') {
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
      socket.on('disconnect', handleDisconnect);
      socket.on('session_update', handleSessionUpdate);

      // Listen for cross-tab token updates via the Storage event.
      // When another tab writes a fresh access token to localStorage,
      // reconnect this tab's socket if it was disconnected.
      const handleStorageEvent = (e: StorageEvent) => {
        if (e.key === LS_ACCESS_TOKEN_KEY && e.newValue && socketRef.current?.disconnected) {
          debug.log('Cross-tab token update detected; reconnecting socket');
          authRetryCount = 0; // reset retries since we got a fresh token
          socketRef.current.connect();
        }
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('storage', handleStorageEvent);
        // Store the handler so cleanup can remove it
        (socket as any).__oxyStorageHandler = handleStorageEvent;
      }
    });

    return () => {
      cancelled = true;
      if (authRetryTimer) {
        clearTimeout(authRetryTimer);
      }
      if (socketRef.current) {
        // Remove cross-tab storage listener
        if (typeof window !== 'undefined' && (socketRef.current as any).__oxyStorageHandler) {
          window.removeEventListener('storage', (socketRef.current as any).__oxyStorageHandler);
        }
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [userId, baseURL]); // Only depend on userId and baseURL - callbacks are in refs
}
