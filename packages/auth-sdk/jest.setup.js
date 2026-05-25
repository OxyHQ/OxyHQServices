// Jest setup for @oxyhq/auth.
//
// Mirrors the services package setup (jsdom + ts-jest), with stubs only
// for the deps that the test files actually touch.

globalThis.__DEV__ = false;

jest.mock('socket.io-client', () => {
  const sockets = [];
  const factory = () => {
    const handlers = new Map();
    const socket = {
      id: 'mock-socket',
      __handlers: handlers,
      on(event, handler) {
        const list = handlers.get(event) || [];
        list.push(handler);
        handlers.set(event, list);
        return socket;
      },
      off(event, handler) {
        const list = handlers.get(event);
        if (!list) return socket;
        if (!handler) {
          handlers.delete(event);
          return socket;
        }
        const filtered = list.filter((h) => h !== handler);
        if (filtered.length === 0) {
          handlers.delete(event);
        } else {
          handlers.set(event, filtered);
        }
        return socket;
      },
      emit(event, ...args) {
        const list = handlers.get(event);
        if (!list) return false;
        for (const h of list) h(...args);
        return true;
      },
      connect() { return socket; },
      disconnect: jest.fn(() => socket),
    };
    sockets.push(socket);
    return socket;
  };
  const io = jest.fn(() => factory());
  io.__sockets = sockets;
  io.__reset = () => {
    sockets.length = 0;
  };
  return {
    __esModule: true,
    default: io,
    io,
  };
}, { virtual: true });

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

jest.setTimeout(10000);
