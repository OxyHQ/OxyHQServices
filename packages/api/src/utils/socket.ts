import { Server as SocketIOServer } from 'socket.io';
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