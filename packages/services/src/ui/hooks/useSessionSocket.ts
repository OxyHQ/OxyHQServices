import { useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { toast } from '../../lib/sonner';
import { logger } from '../../utils/loggerUtils';
import { tokenService } from '../../core/services/TokenService';

interface UseSessionSocketProps {
  userId: string | null | undefined;
  activeSessionId: string | null | undefined;
  currentDeviceId: string | null | undefined;
  refreshSessions: () => Promise<void>;
  logout: () => Promise<void>;
  clearSessionState: () => Promise<void>;
  baseURL: string;
  getAccessToken: () => string | null;
  getTransferCode?: (transferId: string) => { code: string; sourceDeviceId: string | null; publicKey: string; timestamp: number } | null;
  onRemoteSignOut?: () => void;
  onSessionRemoved?: (sessionId: string) => void;
  onIdentityTransferComplete?: (data: { transferId: string; sourceDeviceId: string; publicKey: string; transferCode?: string; completedAt: string }) => void;
}

export function useSessionSocket({ userId, activeSessionId, currentDeviceId, refreshSessions, logout, clearSessionState, baseURL, getAccessToken, getTransferCode, onRemoteSignOut, onSessionRemoved, onIdentityTransferComplete }: UseSessionSocketProps) {
  const socketRef = useRef<any>(null);
  const joinedRoomRef = useRef<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const handlersSetupRef = useRef<boolean>(false);
  const lastRegisteredSocketIdRef = useRef<string | null>(null);
  const getAccessTokenRef = useRef(getAccessToken);
  const getTransferCodeRef = useRef(getTransferCode);
  
  // Store callbacks in refs to avoid re-joining when they change
  const refreshSessionsRef = useRef(refreshSessions);
  const logoutRef = useRef(logout);
  const clearSessionStateRef = useRef(clearSessionState);
  const onRemoteSignOutRef = useRef(onRemoteSignOut);
  const onSessionRemovedRef = useRef(onSessionRemoved);
  const onIdentityTransferCompleteRef = useRef(onIdentityTransferComplete);
  const activeSessionIdRef = useRef(activeSessionId);
  const currentDeviceIdRef = useRef(currentDeviceId);

  // Update refs when callbacks change
  useEffect(() => {
    refreshSessionsRef.current = refreshSessions;
    logoutRef.current = logout;
    clearSessionStateRef.current = clearSessionState;
    onRemoteSignOutRef.current = onRemoteSignOut;
    onSessionRemovedRef.current = onSessionRemoved;
    onIdentityTransferCompleteRef.current = onIdentityTransferComplete;
    activeSessionIdRef.current = activeSessionId;
    currentDeviceIdRef.current = currentDeviceId;
    getAccessTokenRef.current = getAccessToken;
    getTransferCodeRef.current = getTransferCode;
  }, [refreshSessions, logout, clearSessionState, onRemoteSignOut, onSessionRemoved, onIdentityTransferComplete, activeSessionId, currentDeviceId, getAccessToken, getTransferCode]);

  useEffect(() => {
    if (!userId || !baseURL) {
      // Clean up if userId or baseURL becomes invalid
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        joinedRoomRef.current = null;
      }
      return;
    }

    // Initialize socket with token refresh
    const initializeSocket = async () => {
      try {
        // Refresh token if expiring soon before creating socket connection
        await tokenService.refreshTokenIfNeeded();
      } catch (error) {
        // If refresh fails, log but continue with current token
        logger.debug('Token refresh failed before socket connection', { component: 'useSessionSocket', userId, error });
      }

      const accessToken = getAccessTokenRef.current();
      // Recreate socket if token changed or socket doesn't exist
      const tokenChanged = accessTokenRef.current !== accessToken;
      if (!socketRef.current || tokenChanged) {
        // Disconnect old socket if exists
        if (socketRef.current) {
          socketRef.current.disconnect();
          socketRef.current = null;
        }
        
        // Create new socket with authentication
        const socketOptions: any = {
          transports: ['websocket'],
        };
        
        // Get fresh token after potential refresh
        const freshToken = getAccessTokenRef.current();
        if (freshToken) {
          socketOptions.auth = {
            token: freshToken,
          };
        } else {
          logger.debug('No access token available for socket authentication', { component: 'useSessionSocket', userId });
        }
        
        socketRef.current = io(baseURL, socketOptions);
        accessTokenRef.current = freshToken;
        joinedRoomRef.current = null; // Reset room tracking
        handlersSetupRef.current = false; // Reset handlers flag for new socket
      }
      
      const socket = socketRef.current;
      if (!socket) return;
      
      if (!joinedRoomRef.current && socket.connected) {
        joinedRoomRef.current = `user:${userId}`;
      }

      // Set up event handlers (only once per socket instance)
      // Define handlers - they reference socket from closure
      const handleConnect = () => {
      const currentToken = getAccessTokenRef.current();
      if (__DEV__) {
        console.log('[useSessionSocket] Socket connected', {
          socketId: socket.id,
          userId,
          room: `user:${userId}`,
          hasAuth: !!currentToken,
        });
        logger.debug('Socket connected', { component: 'useSessionSocket', socketId: socket.id, userId });
      }
      // Server auto-joins room on connection when authenticated
      // Just track that we're connected
      if (userId) {
        joinedRoomRef.current = `user:${userId}`;
      }
    };

    const handleDisconnect = async (reason: string) => {
      logger.debug('Socket disconnected', { component: 'useSessionSocket', reason, userId });
      joinedRoomRef.current = null;
      
      // If disconnected due to auth error, try to refresh token and reconnect
      if (reason === 'io server disconnect' || reason.includes('auth') || reason.includes('Authentication')) {
        try {
          // Refresh token and reconnect
          await tokenService.refreshTokenIfNeeded();
          const freshToken = getAccessTokenRef.current();
          if (freshToken && socketRef.current) {
            // Update auth and reconnect
            socketRef.current.auth = { token: freshToken };
            socketRef.current.connect();
          }
        } catch (error) {
          logger.debug('Failed to refresh token after disconnect', { component: 'useSessionSocket', userId, error });
        }
      }
    };

    const handleError = (error: Error) => {
      logger.error('Socket error', error, { component: 'useSessionSocket', userId });
    };

    const handleConnectError = async (error: Error) => {
      logger.debug('Socket connection error', { component: 'useSessionSocket', userId, error: error.message });
      
      // If error is due to expired/invalid token, try to refresh and reconnect
      if (error.message.includes('Authentication') || error.message.includes('expired') || error.message.includes('token')) {
        try {
          await tokenService.refreshTokenIfNeeded();
          const freshToken = getAccessTokenRef.current();
          if (freshToken && socketRef.current) {
            // Update auth and reconnect
            socketRef.current.auth = { token: freshToken };
            socketRef.current.connect();
          }
        } catch (refreshError) {
          logger.debug('Failed to refresh token after connection error', { component: 'useSessionSocket', userId, error: refreshError });
        }
      }
    };

    const handleSessionUpdate = async (data: { 
      type: string; 
      sessionId?: string; 
      deviceId?: string; 
      sessionIds?: string[] 
    }) => {
      logger.debug('Received session_update event', {
        component: 'useSessionSocket',
        type: data.type,
        socketId: socket.id,
        socketConnected: socket.connected,
        roomId: joinedRoomRef.current,
      });
      
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
      } else if (data.type === 'identity_transfer_complete') {
        // Handle identity transfer completion notification
        const transferData = data as {
          type: 'identity_transfer_complete';
          transferId: string;
          sourceDeviceId: string;
          publicKey: string;
          transferCode?: string;
          completedAt: string;
        };
        
        logger.debug('Received identity_transfer_complete event', {
          component: 'useSessionSocket',
          transferId: transferData.transferId,
          sourceDeviceId: transferData.sourceDeviceId,
          currentDeviceId,
          activeSessionId: activeSessionIdRef.current,
          socketConnected: socket.connected,
          userId,
          room: joinedRoomRef.current,
          publicKey: transferData.publicKey.substring(0, 16) + '...',
        });
        
        // CRITICAL: Only call handler on the SOURCE device (the one that initiated the transfer)
        // The new device (target) should NEVER process this event - it would delete its own identity!
        
        // Check if this device has a stored transfer code (most reliable check - only source device has this)
        const hasStoredTransferCode = getTransferCodeRef.current && !!getTransferCodeRef.current(transferData.transferId);
        
        // Also check deviceId match (exact match required)
        const deviceIdMatches = transferData.sourceDeviceId && 
                                currentDeviceId && 
                                transferData.sourceDeviceId === currentDeviceId;
        
        // ONLY call handler if BOTH conditions are met:
        // 1. Has stored transfer code (definitive proof this is the source device)
        // 2. DeviceId matches (additional verification)
        // If deviceId is null/undefined, we still allow if stored code exists (logged out source device)
        // But we NEVER process if no stored code exists (definitely not the source device)
        const shouldCallHandler = !!transferData.transferId && 
                                  hasStoredTransferCode && 
                                  (deviceIdMatches || !currentDeviceId); // Allow if deviceId matches OR device is logged out (but has stored code)
        
        if (shouldCallHandler) {
          const matchReason = deviceIdMatches 
            ? 'deviceId-exact-with-stored-code'
            : (currentDeviceId ? 'deviceId-mismatch-but-has-stored-code' : 'logged-out-source-device-with-stored-code');
          
          logger.debug('Matched source device, calling transfer complete handler', {
            component: 'useSessionSocket',
            transferId: transferData.transferId,
            sourceDeviceId: transferData.sourceDeviceId,
            currentDeviceId,
            matchReason,
            hasHandler: !!onIdentityTransferCompleteRef.current,
            socketConnected: socket.connected,
            socketId: socket.id,
          });
          
          if (onIdentityTransferCompleteRef.current) {
            try {
              logger.debug('Calling onIdentityTransferComplete handler', {
                component: 'useSessionSocket',
                transferId: transferData.transferId,
              });
              
              onIdentityTransferCompleteRef.current({
                transferId: transferData.transferId,
                sourceDeviceId: transferData.sourceDeviceId,
                publicKey: transferData.publicKey,
                transferCode: transferData.transferCode,
                completedAt: transferData.completedAt,
              });
              
              logger.debug('onIdentityTransferComplete handler called successfully', {
                component: 'useSessionSocket',
                transferId: transferData.transferId,
              });
            } catch (error) {
              logger.error('Error calling onIdentityTransferComplete handler', error instanceof Error ? error : new Error(String(error)), {
                component: 'useSessionSocket',
                transferId: transferData.transferId,
              });
            }
          } else {
            logger.debug('No onIdentityTransferComplete handler registered', {
              component: 'useSessionSocket',
              transferId: transferData.transferId,
            });
          }
        } else {
          logger.debug('Not the source device, ignoring transfer completion', {
            component: 'useSessionSocket',
            sourceDeviceId: transferData.sourceDeviceId,
            currentDeviceId,
            hasActiveSession: activeSessionIdRef.current !== null,
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
            logger.error('Failed to clear session state after session_update', error instanceof Error ? error : new Error(String(error)), { component: 'useSessionSocket' });
          }
        }
      }
    };

    // Register event handlers (only once per socket instance)
    // Track by socket.id to prevent duplicate registrations when socket reconnects
    const currentSocketId = socket.id || 'pending';
    
    if (!handlersSetupRef.current || lastRegisteredSocketIdRef.current !== currentSocketId) {
      // Remove old handlers if socket changed (reconnection)
      if (socketRef.current && handlersSetupRef.current && lastRegisteredSocketIdRef.current) {
        try {
          socketRef.current.off('connect', handleConnect);
          socketRef.current.off('disconnect', handleDisconnect);
          socketRef.current.off('error', handleError);
          socketRef.current.off('session_update', handleSessionUpdate);
        } catch (error) {
          // Ignore errors when removing handlers
        }
      }
      
      // Register handlers on current socket
      socket.on('connect', handleConnect);
      socket.on('disconnect', handleDisconnect);
      socket.on('error', handleError);
      socket.on('connect_error', handleConnectError);
      socket.on('session_update', handleSessionUpdate);
      
      handlersSetupRef.current = true;
      lastRegisteredSocketIdRef.current = currentSocketId;
      
      logger.debug('Event handlers set up', { component: 'useSessionSocket', socketId: socket.id, userId });
    }

      if (!socket.connected) {
        logger.debug('Socket not connected, connecting...', { component: 'useSessionSocket', userId });
        socket.connect();
      }
    };

    initializeSocket();

    return () => {
      // Only clean up handlers if socket still exists and handlers were set up
      if (socketRef.current && handlersSetupRef.current) {
        try {
          socketRef.current.off('connect');
          socketRef.current.off('disconnect');
          socketRef.current.off('error');
          socketRef.current.off('connect_error');
          socketRef.current.off('session_update');
        } catch (error) {
          // Ignore errors when removing handlers
        }
        handlersSetupRef.current = false;
      }
    };
  }, [userId, baseURL]); // Only depend on userId and baseURL - functions are in refs
}