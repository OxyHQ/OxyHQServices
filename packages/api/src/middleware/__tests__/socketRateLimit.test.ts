import { createSocketRateLimiter } from '../socketRateLimit';

// Minimal Socket mock
function createMockSocket(id = 'socket-1') {
  const listeners: Record<string, Function[]> = {};
  const middlewares: Function[] = [];
  return {
    id,
    use: jest.fn((fn: Function) => {
      middlewares.push(fn);
    }),
    on: jest.fn((event: string, fn: Function) => {
      (listeners[event] ??= []).push(fn);
    }),
    emit: jest.fn(),
    disconnect: jest.fn(),
    // helpers for testing
    _fireEvent(packet: any[] = ['test']) {
      const mw = middlewares[0];
      if (!mw) throw new Error('No middleware installed');
      const next = jest.fn();
      mw(packet, next);
      return next;
    },
    _fireDisconnect() {
      (listeners['disconnect'] ?? []).forEach(fn => fn());
    },
  };
}

describe('createSocketRateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows events under the limit', () => {
    const middleware = createSocketRateLimiter(5, 10_000);
    const socket = createMockSocket();
    const next = jest.fn();

    // Connect
    middleware(socket as any, next);
    expect(next).toHaveBeenCalled();
    expect(socket.use).toHaveBeenCalled();

    // Send 5 events — all should pass
    for (let i = 0; i < 5; i++) {
      const ackNext = socket._fireEvent();
      expect(ackNext).toHaveBeenCalled();
    }

    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects when limit is exceeded', () => {
    const middleware = createSocketRateLimiter(3, 10_000);
    const socket = createMockSocket();
    middleware(socket as any, jest.fn());

    // Send 3 events — OK
    for (let i = 0; i < 3; i++) {
      socket._fireEvent();
    }

    // 4th event — exceeds limit
    const ackNext = socket._fireEvent();
    expect(ackNext).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('resets counter after window expires', () => {
    const middleware = createSocketRateLimiter(3, 1_000);
    const socket = createMockSocket();
    middleware(socket as any, jest.fn());

    // Use up all 3
    for (let i = 0; i < 3; i++) {
      socket._fireEvent();
    }

    // Advance past the window
    jest.advanceTimersByTime(1_100);

    // Should be allowed again
    const ackNext = socket._fireEvent();
    expect(ackNext).toHaveBeenCalled();
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('cleans up state on disconnect', () => {
    const middleware = createSocketRateLimiter(10, 10_000);
    const socket = createMockSocket();
    middleware(socket as any, jest.fn());

    // Send an event to create state
    socket._fireEvent();

    // Disconnect
    socket._fireDisconnect();

    // Reconnect with same id — should start fresh (no accumulated count)
    const socket2 = createMockSocket('socket-1');
    middleware(socket2 as any, jest.fn());

    // Should allow full limit again
    for (let i = 0; i < 10; i++) {
      const ackNext = socket2._fireEvent();
      expect(ackNext).toHaveBeenCalled();
    }
  });
});
