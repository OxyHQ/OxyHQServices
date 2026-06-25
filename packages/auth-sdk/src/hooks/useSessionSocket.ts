import { useEffect, useRef, useMemo } from 'react';
import { toast } from '../utils/toast';
import { logger } from '@oxyhq/core';
import { createDebugLogger } from '@oxyhq/core';
import { useWebOxy } from '../WebOxyProvider';
import { useQueryClient } from '@tanstack/react-query';
import { useSessions } from './queries/useServicesQueries';
import { invalidateSessionQueries } from './queries/queryKeys';

const debug = createDebugLogger('SessionSocket');

/** Delay before retrying socket connection after an auth failure (ms). */
const AUTH_RETRY_DELAY_MS = 2000;

/** Maximum number of consecutive auth-failure retries. */
const MAX_AUTH_RETRIES = 3;

/**
 * Minimal subset of the socket.io-client Socket API used by this hook.
 * We avoid importing socket.io-client types directly because the package
 * is an optional peer dependency.
 *
 * `on()` uses a generic per-call handler signature because each socket event
 * carries its own payload shape.
 */
interface MinimalSocket {
  id?: string;
  disconnected: boolean;
  connect: () => void;
  disconnect: () => void;
  on<Args extends unknown[] = unknown[]>(
    event: string,
    handler: (...args: Args) => void
  ): void;
}

type SocketIOFactory = (uri: string, opts?: Record<string, unknown>) => MinimalSocket;

let _io: SocketIOFactory | null = null;
let _ioLoadAttempted = false;

async function getSocketIO(): Promise<SocketIOFactory | null> {
  if (_io) return _io;
  if (_ioLoadAttempted) return null;
  _ioLoadAttempted = true;
  try {
    const mod = (await import('socket.io-client')) as {
      io?: SocketIOFactory;
      default?: SocketIOFactory;
    };
    _io = mod.io ?? mod.default ?? null;
    return _io;
  } catch (err) {
    console.warn('[oxy.session-socket] socket.io-client import failed:', err);
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

  const socketRef = useRef<MinimalSocket | null>(null);

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

    const resolveToken = (): string | null => oxyServices.getAccessToken();

    const unsubscribeTokenChange = oxyServices.onTokensChanged((token) => {
      if (token && socketRef.current?.disconnected) {
        debug.log('Token update detected; reconnecting socket');
        authRetryCount = 0;
        socketRef.current.connect();
      }
    });

    getSocketIO().then((ioFn) => {
      if (cancelled || !ioFn) return;

      // Connect with auth token; use callback so reconnections get a fresh token.
      // If no token is available at all, we skip the initial connect and let
      // token-change notifications or retry logic connect when a token appears.
      const token = resolveToken();
      const socket = ioFn(baseURL, {
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
      socketRef.current = socket;

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
          if (process.env.NODE_ENV !== 'production') {
            logger.error(
              `Failed to clear session state after ${errorContext}`,
              error instanceof Error ? error : new Error(String(error)),
              { component: 'useSessionSocket' },
            );
          }
        }
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

        // Strict whitelist. Every event type that may sign the user out must
        // appear in the switch. Anything unknown falls through to `default`,
        // which only logs in dev. This guards against future server-side event
        // additions (e.g. `session_created` after a successful sign-in)
        // accidentally triggering sign-out via a fallback branch that compares
        // `data.sessionId === currentActiveSessionId` — that branch would match
        // the user's NEW session id and trigger an instant remote sign-out
        // toast on every login.
        switch (data.type) {
          case 'session_removed': {
            if (data.sessionId && onSessionRemovedRef.current) {
              onSessionRemovedRef.current(data.sessionId);
            }
            if (data.sessionId && data.sessionId === currentActiveSessionId) {
              await triggerLocalSignOut('You have been signed out remotely.', 'session_removed');
            } else {
              refreshSessions();
            }
            break;
          }
          case 'device_removed': {
            if (data.sessionIds && onSessionRemovedRef.current) {
              for (const sessionId of data.sessionIds) {
                onSessionRemovedRef.current(sessionId);
              }
            }
            if (data.deviceId && deviceId && data.deviceId === deviceId) {
              await triggerLocalSignOut(
                'This device has been removed. You have been signed out.',
                'device_removed',
              );
            } else {
              refreshSessions();
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
              refreshSessions();
            }
            break;
          }
          case 'session_created':
          case 'session_update': {
            // Lifecycle event for the current user. Just resync the sessions
            // list — never sign out.
            refreshSessions();
            break;
          }
          default: {
            if (process.env.NODE_ENV !== 'production') {
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
      socket.on('disconnect', handleDisconnect);
      socket.on('session_update', handleSessionUpdate);

    });

    return () => {
      cancelled = true;
      unsubscribeTokenChange();
      if (authRetryTimer) {
        clearTimeout(authRetryTimer);
      }
      const currentSocket = socketRef.current;
      if (currentSocket) {
        currentSocket.disconnect();
        socketRef.current = null;
      }
    };
  }, [userId, baseURL]); // Only depend on userId and baseURL - callbacks are in refs
}
