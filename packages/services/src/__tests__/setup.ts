import '@testing-library/jest-dom';

// Mock React Native APIs
global.jest = require('jest');

// Mock Dimensions
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    Dimensions: {
      get: jest.fn().mockReturnValue({ width: 375, height: 800 }),
    },
    Platform: {
      OS: 'web',
      select: (options: any) => options.web || options.default,
    },
  };
});

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const View = require('react-native').View;
  return {
    ScrollView: View,
    PanGestureHandler: View,
    TapGestureHandler: View,
    FlingGestureHandler: View,
    PinchGestureHandler: View,
    RotationGestureHandler: View,
    State: {},
    PanResponder: {
      create: jest.fn(() => ({
        panHandlers: {},
      })),
    },
  };
});