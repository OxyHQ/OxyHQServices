import { useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { toast } from '../../lib/sonner';

interface UseSessionSocketProps {
  userId: string | null | undefined;
  activeSessionId: string | null | undefined;
  refreshSessions: () => Promise<void>;
  logout: () => Promise<void>;
  baseURL: string;
  onRemoteSignOut?: () => void;
}

export function useSessionSocket({ userId, activeSessionId, refreshSessions, logout, baseURL, onRemoteSignOut }: UseSessionSocketProps) {
  const socketRef = useRef<any>(null);
  const joinedRoomRef = useRef<string | null>(null);
  
  // Store callbacks in refs to avoid re-joining when they change
  const refreshSessionsRef = useRef(refreshSessions);
  const logoutRef = useRef(logout);
  const onRemoteSignOutRef = useRef(onRemoteSignOut);
  const activeSessionIdRef = useRef(activeSessionId);

  // Update refs when callbacks change
  useEffect(() => {
    refreshSessionsRef.current = refreshSessions;
    logoutRef.current = logout;
    onRemoteSignOutRef.current = onRemoteSignOut;
    activeSessionIdRef.current = activeSessionId;
  }, [refreshSessions, logout, onRemoteSignOut, activeSessionId]);

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

    const handleSessionUpdate = (data: { type: string; sessionId: string }) => {
      if (__DEV__) {
        console.log('Received session_update:', data);
      }
      
      // Use refs to get latest callback versions
      refreshSessionsRef.current();
      
      // If the current session was logged out, handle it specially
      if (data.sessionId === activeSessionIdRef.current) {
        if (onRemoteSignOutRef.current) {
          onRemoteSignOutRef.current();
        } else {
          toast.info('You have been signed out remotely.');
        }
        logoutRef.current();
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