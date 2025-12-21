import { useQuery } from '@tanstack/react-query';
import { useTransferStore } from '../stores/transferStore';
import type { OxyServices } from '../../core';

/**
 * Query keys for transfer-related queries
 */
export const transferQueryKeys = {
  pending: () => ['transfers', 'pending'] as const,
};

/**
 * Hook to check all pending transfers for completion
 * Used when app comes back online
 * 
 * This version accepts oxyServices and isAuthenticated as parameters to avoid
 * circular dependency when used inside OxyContext
 */
export const useCheckPendingTransfers = (
  oxyServices?: OxyServices | null,
  isAuthenticated?: boolean
) => {
  const getAllPendingTransfers = useTransferStore((state) => state.getAllPendingTransfers);
  const pendingTransfers = getAllPendingTransfers();
  
  return useQuery({
    queryKey: [...transferQueryKeys.pending(), pendingTransfers.map(t => t.transferId).join(',')],
    queryFn: async () => {
      if (!oxyServices || pendingTransfers.length === 0) {
        return [];
      }

      const results: Array<{
        transferId: string;
        completed: boolean;
        data?: {
          transferId?: string;
          sourceDeviceId?: string;
          publicKey?: string;
          transferCode?: string;
          completedAt?: string;
        };
      }> = [];

      // Check each pending transfer
      for (const { transferId, data } of pendingTransfers) {
        try {
          const response = await oxyServices.makeRequest<{
            completed: boolean;
            transferId?: string;
            sourceDeviceId?: string;
            publicKey?: string;
            transferCode?: string;
            completedAt?: string;
          }>(
            'GET',
            `/api/identity/check-transfer/${transferId}`,
            undefined,
            { cache: false }
          );

          if (response.completed && response.publicKey === data.publicKey) {
            results.push({
              transferId,
              completed: true,
              data: response,
            });
          } else {
            results.push({
              transferId,
              completed: false,
            });
          }
        } catch (error: any) {
          // Handle 401 errors gracefully - skip this transfer
          if (error?.status === 401 || error?.message?.includes('401') || error?.message?.includes('authentication')) {
            if (__DEV__) {
              console.warn(`[useCheckPendingTransfers] Authentication required for transfer ${transferId}, skipping`);
            }
            results.push({
              transferId,
              completed: false,
            });
            continue;
          }
          // For other errors, mark as not completed
          results.push({
            transferId,
            completed: false,
          });
        }
      }

      return results;
    },
    enabled: (isAuthenticated ?? false) && !!oxyServices && pendingTransfers.length > 0,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry - we'll check again on next reconnect
  });
};

