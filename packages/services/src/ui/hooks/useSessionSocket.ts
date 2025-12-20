import { useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { toast } from '../../lib/sonner';
import { logger } from '../../utils/loggerUtils';

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
  }, [refreshSessions, logout, clearSessionState, onRemoteSignOut, onSessionRemoved, onIdentityTransferComplete, activeSessionId, currentDeviceId]);

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

    const accessToken = getAccessToken();
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
      
      if (accessToken) {
        socketOptions.auth = {
          token: accessToken,
        };
        if (__DEV__) {
          console.log('[useSessionSocket] Creating socket with auth token', {
            userId,
            hasToken: !!accessToken,
            tokenLength: accessToken.length,
          });
        }
      } else {
        if (__DEV__) {
          console.warn('[useSessionSocket] No access token available for socket authentication');
        }
      }
      
      socketRef.current = io(baseURL, socketOptions);
      accessTokenRef.current = accessToken;
      joinedRoomRef.current = null; // Reset room tracking
      handlersSetupRef.current = false; // Reset handlers flag for new socket
    }
    
    const socket = socketRef.current;
    
    // Server auto-joins room on connection when authenticated, so we don't need to manually join
    // Just track that we're in the room
    if (!joinedRoomRef.current && socket.connected) {
      joinedRoomRef.current = `user:${userId}`;
      if (__DEV__) {
        console.log('[useSessionSocket] Socket connected, should be auto-joined to room', {
          userId,
          room: `user:${userId}`,
        });
      }
    }

    // Set up event handlers (only once per socket instance)
    // Define handlers outside if block so they're always available
    const handleConnect = () => {
      const currentToken = getAccessToken();
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

    const handleDisconnect = (reason: string) => {
      if (__DEV__) {
        console.log('[useSessionSocket] Socket disconnected:', reason);
        logger.debug('Socket disconnected', { component: 'useSessionSocket', reason, userId });
      }
      joinedRoomRef.current = null; // Reset room tracking on disconnect
    };

    const handleError = (error: Error) => {
      if (__DEV__) {
        console.error('[useSessionSocket] Socket error', error);
        logger.error('Socket error', error, { component: 'useSessionSocket', userId });
      }
    };

    const handleSessionUpdate = async (data: { 
      type: string; 
      sessionId?: string; 
      deviceId?: string; 
      sessionIds?: string[] 
    }) => {
      if (__DEV__) {
        console.log('[useSessionSocket] Received session_update event:', {
          type: data.type,
          socketId: socket.id,
          socketConnected: socket.connected,
          roomId: joinedRoomRef.current,
        });
      }
      
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
        
        if (__DEV__) {
          console.log('[useSessionSocket] Received identity_transfer_complete event', {
            transferId: transferData.transferId,
            sourceDeviceId: transferData.sourceDeviceId,
            currentDeviceId,
            hasActiveSession: activeSessionIdRef.current !== null,
            socketConnected: socket.connected,
          });
        }
        
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
        
        // Only call handler on the SOURCE device (the one that initiated the transfer)
        // The source device is identified by:
        // 1. Matching deviceId with sourceDeviceId, OR
        // 2. Having a stored transfer code for this transferId (most reliable check)
        const deviceIdMatches = transferData.sourceDeviceId && transferData.sourceDeviceId === currentDeviceId;
        
        // Check if this device has a stored transfer code (meaning it's the source device)
        const hasStoredTransferCode = getTransferCode && !!getTransferCode(transferData.transferId);
        
        // Only call handler if this is the source device
        // We check both deviceId match AND stored transfer code to handle cases where
        // deviceId might be null (logged out device) but transfer code still exists
        const shouldCallHandler = !!transferData.transferId && (deviceIdMatches || hasStoredTransferCode);
        
        if (shouldCallHandler) {
          const matchReason = deviceIdMatches 
            ? 'deviceId-exact'
            : (activeSessionIdRef.current !== null ? 'active-session' : 'transferId-only');
          
          if (__DEV__) {
            console.log('[useSessionSocket] Matched source device, calling handler', {
              transferId: transferData.transferId,
              matchReason,
              sourceDeviceId: transferData.sourceDeviceId,
              currentDeviceId,
            });
          }
          
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
          
          // Call the handler - it will verify using stored transfer codes
          if (onIdentityTransferCompleteRef.current) {
            try {
              if (__DEV__) {
                console.log('[useSessionSocket] Calling onIdentityTransferComplete handler', {
                  transferId: transferData.transferId,
                });
              }
              
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
              
              if (__DEV__) {
                console.log('[useSessionSocket] Handler called successfully', {
                  transferId: transferData.transferId,
                });
              }
              
              logger.debug('onIdentityTransferComplete handler called successfully', {
                component: 'useSessionSocket',
                transferId: transferData.transferId,
              });
            } catch (error) {
              if (__DEV__) {
                console.error('[useSessionSocket] Error calling handler', error);
              }
              logger.error('Error calling onIdentityTransferComplete handler', error instanceof Error ? error : new Error(String(error)), {
                component: 'useSessionSocket',
                transferId: transferData.transferId,
              });
            }
          } else {
            if (__DEV__) {
              console.warn('[useSessionSocket] No handler registered');
            }
            logger.debug('No onIdentityTransferComplete handler registered', {
              component: 'useSessionSocket',
              transferId: transferData.transferId,
            });
          }
        } else {
          if (__DEV__) {
            console.log('[useSessionSocket] Not matched, ignoring', {
              sourceDeviceId: transferData.sourceDeviceId,
              currentDeviceId,
              hasActiveSession: activeSessionIdRef.current !== null,
            });
          }
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
            if (__DEV__) {
              console.error('Failed to clear session state after session_update:', error);
            }
          }
        }
      }
    };

    // Register event handlers (only once per socket instance)
    if (!handlersSetupRef.current) {
      socket.on('connect', handleConnect);
      socket.on('disconnect', handleDisconnect);
      socket.on('error', handleError);
      socket.on('session_update', handleSessionUpdate);
      
      handlersSetupRef.current = true;
      
      if (__DEV__) {
        console.log('[useSessionSocket] Event handlers set up', {
          socketId: socket.id,
          userId,
        });
      }
    }

    // Ensure socket is connected before proceeding
    if (!socket.connected) {
      if (__DEV__) {
        console.log('[useSessionSocket] Socket not connected, connecting...', { userId });
        logger.debug('Socket not connected, waiting for connection', { component: 'useSessionSocket', userId });
      }
      socket.connect();
    } else {
      if (__DEV__) {
        console.log('[useSessionSocket] Socket already connected', { 
          socketId: socket.id, 
          userId,
          connected: socket.connected 
        });
      }
    }

    return () => {
      // Only clean up handlers if socket still exists and handlers were set up
      if (socketRef.current && handlersSetupRef.current) {
        socketRef.current.off('connect', handleConnect);
        socketRef.current.off('disconnect', handleDisconnect);
        socketRef.current.off('error', handleError);
        socketRef.current.off('session_update', handleSessionUpdate);
        handlersSetupRef.current = false;
      }
    };
  }, [userId, baseURL, getAccessToken]); // Depend on userId, baseURL, and getAccessToken
} 