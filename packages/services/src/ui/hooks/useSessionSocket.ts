import { useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { toast } from '../../lib/sonner';

interface UseSessionSocketProps {
  userId: string | null | undefined;
  activeSessionId: string | null | undefined;
  currentDeviceId: string | null | undefined;
  refreshSessions: () => Promise<void>;
  logout: () => Promise<void>;
  clearSessionState: () => Promise<void>;
  baseURL: string;
  onRemoteSignOut?: () => void;
  onSessionRemoved?: (sessionId: string) => void;
}

export function useSessionSocket({ userId, activeSessionId, currentDeviceId, refreshSessions, logout, clearSessionState, baseURL, onRemoteSignOut, onSessionRemoved }: UseSessionSocketProps) {
  const socketRef = useRef<any>(null);
  const joinedRoomRef = useRef<string | null>(null);
  
  // Store callbacks in refs to avoid re-joining when they change
  const refreshSessionsRef = useRef(refreshSessions);
  const logoutRef = useRef(logout);
  const clearSessionStateRef = useRef(clearSessionState);
  const onRemoteSignOutRef = useRef(onRemoteSignOut);
  const onSessionRemovedRef = useRef(onSessionRemoved);
  const activeSessionIdRef = useRef(activeSessionId);
  const currentDeviceIdRef = useRef(currentDeviceId);

  // Update refs when callbacks change
  useEffect(() => {
    refreshSessionsRef.current = refreshSessions;
    logoutRef.current = logout;
    clearSessionStateRef.current = clearSessionState;
    onRemoteSignOutRef.current = onRemoteSignOut;
    onSessionRemovedRef.current = onSessionRemoved;
    activeSessionIdRef.current = activeSessionId;
    currentDeviceIdRef.current = currentDeviceId;
  }, [refreshSessions, logout, clearSessionState, onRemoteSignOut, onSessionRemoved, activeSessionId, currentDeviceId]);

  useEffect(() => {
    if (!userId || !baseURL) {
      // Clean up if userId or baseURL becomes invalid
      if (socketRef.current && joinedRoomRef.current) {
        socketRef.current.emit('leave', { userId: joinedRoomRef.current });
        joinedRoomRef.current = null;
      }
      return;
    }

    const roomId = `user:${userId}`;
    
    // Only create socket if it doesn't exist
    if (!socketRef.current) {
      socketRef.current = io(baseURL, {
        transports: ['websocket'],
      });
    }
    const socket = socketRef.current;

    // Only join if we haven't already joined this room
    if (joinedRoomRef.current !== roomId) {
      // Leave previous room if switching users
      if (joinedRoomRef.current) {
        socket.emit('leave', { userId: joinedRoomRef.current });
      }
      
      socket.emit('join', { userId: roomId });
      joinedRoomRef.current = roomId;
      
      if (__DEV__) {
        console.log('Emitting join for room:', roomId);
      }
    }

    // Set up event handlers (only once per socket instance)
    const handleConnect = () => {
      if (__DEV__) {
        console.log('Socket connected:', socket.id);
      }
    };

    const handleSessionUpdate = (data: { 
      type: string; 
      sessionId?: string; 
      deviceId?: string; 
      sessionIds?: string[] 
    }) => {
      if (__DEV__) {
        console.log('Received session_update:', data);
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
          clearSessionStateRef.current();
        } else {
          // Otherwise, just refresh the sessions list (with error handling)
          refreshSessionsRef.current().catch((error) => {
            // Silently handle errors from refresh - they're expected if sessions were removed
            if (__DEV__) {
              console.debug('Failed to refresh sessions after session_removed:', error);
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
          clearSessionStateRef.current();
        } else {
          // Otherwise, refresh sessions and device list (with error handling)
          refreshSessionsRef.current().catch((error) => {
            // Silently handle errors from refresh - they're expected if sessions were removed
            if (__DEV__) {
              console.debug('Failed to refresh sessions after device_removed:', error);
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
          clearSessionStateRef.current();
        } else {
          // Otherwise, refresh sessions list (with error handling)
          refreshSessionsRef.current().catch((error) => {
            // Silently handle errors from refresh - they're expected if sessions were removed
            if (__DEV__) {
              console.debug('Failed to refresh sessions after sessions_removed:', error);
            }
          });
        }
      } else {
        // For other event types (e.g., session_created), refresh sessions (with error handling)
        refreshSessionsRef.current().catch((error) => {
          // Log but don't throw - refresh errors shouldn't break the socket handler
          if (__DEV__) {
            console.debug('Failed to refresh sessions after session_update:', error);
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
          clearSessionStateRef.current();
        }
      }
    };

    socket.on('connect', handleConnect);
    socket.on('session_update', handleSessionUpdate);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('session_update', handleSessionUpdate);
      
      // Only leave on unmount if we're still in this room
      if (joinedRoomRef.current === roomId) {
        socket.emit('leave', { userId: roomId });
        joinedRoomRef.current = null;
      }
    };
  }, [userId, baseURL]); // Only depend on userId and baseURL - callbacks are in refs
} 