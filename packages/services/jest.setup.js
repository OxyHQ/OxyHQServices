// Jest setup file
require('@testing-library/jest-dom');

// Global test timeout
jest.setTimeout(30000);

// Mock react-native modules that aren't available in test environment
jest.mock('react-native', () => {
  const ReactNative = jest.requireActual('react-native');
  return {
    ...ReactNative,
    Platform: {
      OS: 'ios',
      select: jest.fn((options) => options.ios),
    },
    Dimensions: {
      get: jest.fn().mockReturnValue({ width: 375, height: 812 }),
    },
  };
});

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: 'View',
  PanGestureHandler: 'View',
  TapGestureHandler: 'View',
  State: {},
}));

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => ({
  useSharedValue: jest.fn(() => ({ value: 0 })),
  useAnimatedStyle: jest.fn(() => ({})),
  withTiming: jest.fn((value) => value),
  withSpring: jest.fn((value) => value),
  runOnJS: jest.fn((fn) => fn),
}));

// Mock axios
jest.mock('axios');