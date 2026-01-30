import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { User } from '@oxyhq/core';
import { queryKeys, invalidateSessionQueries } from '../queries/queryKeys';
import { useOxy } from '../../context/OxyContext';
import { toast } from '../../../lib/sonner';

/**
 * Switch active session
 */
export const useSwitchSession = () => {
  const { switchSession, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      return await switchSession(sessionId);
    },
    onSuccess: (user) => {
      // Invalidate all session queries
      invalidateSessionQueries(queryClient);
      
      // Update current user query
      queryClient.setQueryData(queryKeys.accounts.current(), user);
      
      // Invalidate account queries
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to switch session');
    },
  });
};

/**
 * Logout from a session
 */
export const useLogoutSession = () => {
  const { oxyServices, activeSessionId, sessions } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (targetSessionId?: string) => {
      if (!activeSessionId) {
        throw new Error('No active session');
      }
      
      const sessionToLogout = targetSessionId || activeSessionId;
      await oxyServices.logoutSession(activeSessionId, sessionToLogout);
      
      return sessionToLogout;
    },
    onMutate: async (targetSessionId) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: queryKeys.sessions.all });
      
      // Snapshot previous sessions
      const previousSessions = queryClient.getQueryData(queryKeys.sessions.list());
      
      // Optimistically remove session
      if (previousSessions) {
        const sessionToLogout = targetSessionId || activeSessionId;
        const updatedSessions = (previousSessions as any[]).filter(
          (s: any) => s.sessionId !== sessionToLogout
        );
        queryClient.setQueryData(queryKeys.sessions.list(), updatedSessions);
      }
      
      return { previousSessions };
    },
    onError: (error, targetSessionId, context) => {
      // Rollback on error
      if (context?.previousSessions) {
        queryClient.setQueryData(queryKeys.sessions.list(), context.previousSessions);
      }
      toast.error(error instanceof Error ? error.message : 'Failed to logout');
    },
    onSuccess: () => {
      // Invalidate all session queries
      invalidateSessionQueries(queryClient);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    },
  });
};

/**
 * Logout from all sessions
 */
export const useLogoutAll = () => {
  const { oxyServices, activeSessionId, clearSessionState } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!activeSessionId) {
        throw new Error('No active session');
      }
      
      await oxyServices.logoutAllSessions(activeSessionId);
      await clearSessionState();
    },
    onSuccess: () => {
      // Clear all queries
      queryClient.clear();
      toast.success('Logged out from all sessions');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to logout from all sessions');
    },
  });
};

/**
 * Update device name
 */
export const useUpdateDeviceName = () => {
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (deviceName: string) => {
      if (!activeSessionId) {
        throw new Error('No active session');
      }
      
      return await oxyServices.updateDeviceName(activeSessionId, deviceName);
    },
    onSuccess: () => {
      // Invalidate device and session queries
      queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      toast.success('Device name updated');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update device name');
    },
  });
};

/**
 * Remove a device
 */
export const useRemoveDevice = () => {
  const { oxyServices } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (deviceId: string) => {
      await oxyServices.removeDevice(deviceId);
      return deviceId;
    },
    onSuccess: () => {
      // Invalidate device queries
      queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      toast.success('Device removed');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove device');
    },
  });
};

