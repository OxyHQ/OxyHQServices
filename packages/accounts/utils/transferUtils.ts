import type { OxyServices } from '@oxyhq/services';

export interface TransferCompleteParams {
  transferId: string;
  sourceDeviceId: string;
  publicKey: string;
  transferCode: string;
}

export interface TransferCompleteResult {
  success: boolean;
  error?: string;
}

/**
 * Notifies the server about successful identity transfer completion.
 * Implements retry logic with exponential backoff.
 * 
 * @param oxyServices - OxyServices instance for making API requests
 * @param params - Transfer completion parameters
 * @param options - Retry configuration (default: 3 retries, starting at 1s delay)
 * @returns Promise resolving to success status
 */
export async function notifyTransferComplete(
  oxyServices: OxyServices,
  params: TransferCompleteParams,
  options: { maxRetries?: number; initialDelay?: number } = {}
): Promise<TransferCompleteResult> {
  const { maxRetries = 3, initialDelay = 1000 } = options;
  const { transferId, sourceDeviceId, publicKey, transferCode } = params;

  if (!transferId || !sourceDeviceId || !publicKey || !oxyServices) {
    return { success: false, error: 'Missing required parameters' };
  }

  let retries = maxRetries;
  let delay = initialDelay;

  while (retries > 0) {
    try {
      await oxyServices.makeRequest(
        'POST',
        '/api/identity/transfer-complete',
        {
          transferId,
          sourceDeviceId,
          publicKey,
          transferCode,
        },
        { cache: false }
      );
      return { success: true };
    } catch (err: any) {
      retries--;
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        if (__DEV__) {
          console.warn('[transferUtils] Failed to notify transfer completion after retries:', err);
        }
        return { success: false, error: err?.message || 'Failed to notify server' };
      }
    }
  }

  return { success: false, error: 'Unexpected error' };
}


