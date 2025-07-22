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

  useEffect(() => {
    if (!userId || !baseURL) return;

    if (!socketRef.current) {
      socketRef.current = io(baseURL, {
        transports: ['websocket'],
      });
    }
    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
    });

    socket.emit('join', { userId: `user:${userId}` });
    console.log('Emitting join for room:', `user:${userId}`);

    socket.on('session_update', (data: { type: string; sessionId: string }) => {
      console.log('Received session_update:', data);
      
      // Always refresh sessions to get the latest state
      refreshSessions();
      
      // If the current session was logged out, handle it specially
      if (data.sessionId === activeSessionId) {
        if (onRemoteSignOut) onRemoteSignOut();
        else toast.info('You have been signed out remotely.');
        logout();
      }
    });

    return () => {
      socket.emit('leave', { userId: `user:${userId}` });
      socket.off('session_update');
    };
  }, [userId, baseURL, activeSessionId, refreshSessions, logout, onRemoteSignOut]);
} 