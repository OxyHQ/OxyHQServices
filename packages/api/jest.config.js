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
    // The protocol node subpath (NodeClient, used by nodeSync.service) — resolve
    // from source like the protocol root so the api-test job needs no prior build.
    '^@oxyhq/protocol/node$': '<rootDir>/../protocol/src/node/index.ts',
    // Same rationale for @oxyhq/protocol (canonicalize / signedRecordSigningInput /
    // computeRecordId, imported by the signed-record + civic + node-sync services):
    // resolve from source so the api-test job needs no prior protocol build.
    '^@oxyhq/protocol$': '<rootDir>/../protocol/src/index.ts',
    // Same rationale for @oxyhq/core/server (safeFetch/SsrfRejection, imported by
    // federation.service.ts + email.service.ts): the core dist is absent in the CI
    // `api-test` job (which runs tests without building workspace deps). Resolve it
    // from source so the import — and the `jest.mock('@oxyhq/core/server', ...)`
    // factories that replace it — resolve without a prior core build.
    '^@oxyhq/core/server$': '<rootDir>/../core/src/server/index.ts',
    // NodeNext source uses `.js` extensions on relative imports of TS files
    // (e.g. `import { Topic } from '../models/Topic.js'`). ts-jest resolves
    // these inside source, but jest's own resolver (used by `jest.mock(...)`
    // string paths) does not strip the extension. Map relative `.js` imports
    // back to their extensionless form so both source loads and `jest.mock`
    // calls resolve to the `.ts` file.
    '^(\\.{1,2}/.*)\\.js$': '$1',
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