import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { useOxy } from '../../context/OxyContext';
import type { SecurityActivity, SecurityEventType } from '../../../models/interfaces';

/**
 * Get user's security activity with pagination
 */
export const useSecurityActivity = (
  options?: {
    limit?: number;
    offset?: number;
    eventType?: SecurityEventType;
    enabled?: boolean;
  }
) => {
  const { oxyServices, activeSessionId } = useOxy();

  return useQuery({
    queryKey: queryKeys.security.activity(
      options?.limit,
      options?.offset,
      options?.eventType
    ),
    queryFn: async () => {
      if (!activeSessionId) {
        throw new Error('No active session');
      }

      const response = await oxyServices.getSecurityActivity(
        options?.limit,
        options?.offset,
        options?.eventType
      );

      return response;
    },
    enabled: (options?.enabled !== false) && !!activeSessionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};

/**
 * Get recent security activity (convenience hook)
 */
export const useRecentSecurityActivity = (limit: number = 10) => {
  const { oxyServices, activeSessionId } = useOxy();

  return useQuery<SecurityActivity[]>({
    queryKey: queryKeys.security.recent(limit),
    queryFn: async () => {
      if (!activeSessionId) {
        throw new Error('No active session');
      }

      return await oxyServices.getRecentSecurityActivity(limit);
    },
    enabled: !!activeSessionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};

