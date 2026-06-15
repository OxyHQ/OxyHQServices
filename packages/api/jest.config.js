module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    // Resolve @oxyhq/contracts from its TypeScript SOURCE so api tests do not
    // depend on the contracts package being built first (its dist is absent in
    // the CI `api-test` job). ts-jest transforms the source via the transform
    // regex below; the contracts source only imports `zod`, which resolves
    // normally from node_modules.
    '^@oxyhq/contracts$': '<rootDir>/../contracts/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      diagnostics: false,
    }],
  },
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
  ],
  testTimeout: 10000,
};