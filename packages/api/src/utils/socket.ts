import type { Server as SocketIOServer } from 'socket.io';
import type { DeviceSessionState } from '@oxyhq/contracts';
import { logger } from './logger';

let io: SocketIOServer | null = null;

export const initializeIO = (socketIO: SocketIOServer) => {
  io = socketIO;
};

export const getIO = () => {
  return io;
};

export const closeIO = () => {
  if (io) {
    if (typeof io.close === 'function') io.close();
    io = null;
  }
};

export function broadcastDeviceState(state: DeviceSessionState): void {
  const server = getIO();
  if (!server) {
    logger.debug('broadcastDeviceState: io not initialised', { deviceId: state.deviceId });
    return;
  }
  server.to(`device:${state.deviceId}`).emit('session_state', state);
}

export function deviceRoomFor(decoded: { deviceId?: string | null }): string | null {
  return decoded?.deviceId ? `device:${decoded.deviceId}` : null;
}

/**
 * The rooms a connected socket should join, given its resolved identity. An
 * AUTHENTICATED user socket joins BOTH `user:<id>` (notifications) and its
 * `device:<deviceId>` room (JWT claim). A device-only socket joins ONLY its
 * `device:<deviceId>` room — ids are always server-resolved, never client-supplied.
 */
export function socketRoomsFor(identity: {
  user?: { id: string; deviceId?: string | null } | null;
  deviceId?: string | null;
}): string[] {
  const rooms: string[] = [];
  if (identity.user?.id) {
    rooms.push(`user:${identity.user.id}`);
  }
  const deviceRoom = identity.user
    ? deviceRoomFor(identity.user)
    : identity.deviceId
      ? `device:${identity.deviceId}`
      : null;
  if (deviceRoom) {
    rooms.push(deviceRoom);
  }
  return rooms;
}