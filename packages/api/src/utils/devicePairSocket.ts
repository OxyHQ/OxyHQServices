/**
 * Device-Pair Socket Utilities (b3 Feature 2 — device-to-device identity transfer)
 *
 * Real-time notification for the "add a device" flow. The new (waiting) device
 * joins room `devicepair:<pairingId>` on the `/device-pair` namespace; when the
 * old device approves or denies, the server pushes a lightweight status signal
 * so the new device fetches the sealed material via
 * `GET /identity/device-transfer/:pairingId`. Polling is the fallback.
 *
 * Mirrors `authSessionSocket.ts`. The push carries NO key material — only the
 * pairing status — so the socket channel needs no confidentiality (the material
 * itself is E2E-encrypted end to end regardless).
 */

import type { Namespace } from 'socket.io';
import { logger } from './logger';

let devicePairNamespace: Namespace | null = null;

/**
 * Initialize the device-pair namespace reference.
 * Called from server.ts after Socket.IO is set up.
 */
export function initDevicePairNamespace(namespace: Namespace): void {
  devicePairNamespace = namespace;
}

/**
 * Emit a device-pair status update to the waiting new device.
 * Used when the old device approves, denies, or the pairing expires.
 */
export function emitDevicePairUpdate(
  pairingId: string,
  payload: { status: 'approved' | 'denied' | 'expired' },
): void {
  if (!devicePairNamespace) {
    logger.warn('Device-pair namespace not initialized');
    return;
  }

  const room = `devicepair:${pairingId}`;
  devicePairNamespace.to(room).emit('device_pair_update', payload);
}
