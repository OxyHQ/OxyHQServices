/**
 * Socket.IO Rate Limiting Middleware
 *
 * Tracks event count per socket within a sliding window.
 * Disconnects sockets that exceed the configured threshold.
 */

import type { Socket } from 'socket.io';
import { logger } from '../utils/logger';

interface RateLimitState {
  count: number;
  resetAt: number;
}

const DEFAULT_MAX_EVENTS = 100;
const DEFAULT_WINDOW_MS = 10_000; // 10 seconds

/**
 * Creates a Socket.IO rate limiting middleware.
 *
 * Apply with `io.use(createSocketRateLimiter())` as a connection-level middleware,
 * then inside the connection handler it installs a per-event counter via `socket.use`.
 *
 * @param maxEvents - Maximum events allowed per window (default: 100)
 * @param windowMs - Time window in milliseconds (default: 10,000)
 */
export function createSocketRateLimiter(
  maxEvents = DEFAULT_MAX_EVENTS,
  windowMs = DEFAULT_WINDOW_MS
) {
  const clients = new Map<string, RateLimitState>();

  // Periodically clean up disconnected clients
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, state] of clients) {
      if (now > state.resetAt + windowMs) {
        clients.delete(id);
      }
    }
  }, windowMs * 2);

  // Allow the interval to not keep the process alive
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return function rateLimitMiddleware(socket: Socket, next: (err?: Error) => void) {
    // Install per-event rate limiting via socket.use
    socket.use((packet, ackNext) => {
      const now = Date.now();
      let state = clients.get(socket.id);

      if (!state || now > state.resetAt) {
        state = { count: 0, resetAt: now + windowMs };
        clients.set(socket.id, state);
      }

      state.count++;

      if (state.count > maxEvents) {
        logger.warn('Socket rate limit exceeded, disconnecting', {
          socketId: socket.id,
          count: state.count,
          maxEvents,
        });
        socket.emit('error', { message: 'Rate limit exceeded' });
        socket.disconnect(true);
        return;
      }

      ackNext();
    });

    // Clean up when socket disconnects
    socket.on('disconnect', () => {
      clients.delete(socket.id);
    });

    next();
  };
}
