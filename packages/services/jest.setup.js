// Jest setup file
// Note: react-native-url-polyfill is mocked instead of imported to avoid ES module issues

// Mock React Native modules that don't exist in Node.js environment
jest.mock('react-native', () => ({
  Platform: {
    OS: 'test',
    select: jest.fn((obj) => obj.default || obj.web || obj.native),
  },
  Dimensions: {
    get: jest.fn(() => ({ width: 375, height: 667 })),
  },
  StyleSheet: {
    create: jest.fn((styles) => styles),
  },
}));

// Mock the URL polyfill 
jest.mock('react-native-url-polyfill/auto', () => {});

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

// Mock socket.io-client
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  })),
}));

// Mock axios to prevent actual network requests
jest.mock('axios', () => {
  const mockClient = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    defaults: { baseURL: 'https://test.example.com', timeout: 10000 },
  };
  const create = jest.fn((config) => {
    if (config && config.baseURL) {
      mockClient.defaults.baseURL = config.baseURL;
    }
    if (config && config.timeout) {
      mockClient.defaults.timeout = config.timeout;
    }
    return mockClient;
  });
  return {
    create,
    default: { create },
  };
});

// Set test timeout
jest.setTimeout(10000);

// Ensure auth tokens do not leak across tests
afterEach(() => {
  try {
    const { OxyServices } = require('./src/core/OxyServices');
    if (OxyServices && typeof OxyServices.__resetTokensForTests === 'function') {
      OxyServices.__resetTokensForTests();
    }
  } catch {}
});
