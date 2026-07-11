import { useOxyEvent } from '@oxyhq/services';

export interface AttestedEventPayload {
  byUserId: string;
  recordId: string;
  points: number;
  at: string;
}

/**
 * Fires when the server confirms a real-life attestation for the CURRENT user
 * (`civic:attested` on the user socket room). Strict shape whitelist — a
 * malformed push is dropped, never partially applied.
 */
export function useAttestedEvent(onAttested: (payload: AttestedEventPayload) => void): void {
  useOxyEvent('civic:attested', (payload) => {
    if (payload === null || typeof payload !== 'object') return;
    const p = payload as Record<string, unknown>;
    if (
      typeof p.byUserId !== 'string' ||
      typeof p.recordId !== 'string' ||
      typeof p.points !== 'number' ||
      typeof p.at !== 'string'
    ) {
      return;
    }
    onAttested({ byUserId: p.byUserId, recordId: p.recordId, points: p.points, at: p.at });
  });
}
