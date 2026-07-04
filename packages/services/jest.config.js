module.exports = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      diagnostics: false,
      tsconfig: {
        jsx: 'react-jsx',
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        isolatedModules: true,
        target: 'es2020',
        lib: ['es2020', 'dom'],
      },
    }],
  },
  testMatch: [
    '<rootDir>/__tests__/**/*.(test|spec).(ts|tsx|js)',
    '<rootDir>/src/**/__tests__/**/*.(test|spec).(ts|tsx|js)',
    '<rootDir>/src/**/*.(test|spec).(ts|tsx|js)',
  ],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/__tests__/**',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^react-native$': '<rootDir>/__tests__/__mocks__/react-native.ts',
    '^react-native-reanimated$': '<rootDir>/__tests__/__mocks__/reanimated.ts',
    '^@oxyhq/bloom$': '<rootDir>/__tests__/__mocks__/bloom.ts',
    '^@oxyhq/bloom/(.*)$': '<rootDir>/__tests__/__mocks__/bloom.ts',
  },
  testTimeout: 10000,
};
