module.exports = {
  // Bounded because every worker opens its OWN Postgres pool against the one
  // test server. With `PG_MAX_POOL_SIZE = 8` (see `jest.globalSetup.ts`, where
  // 8 is a floor set by the backfill's own copy concurrency), 10 workers ask
  // for at most 80 connections against a `max_connections` of 100 — under the
  // ceiling with room for the migrator's own session and a psql.
  //
  // Unbounded, jest forks one worker per core minus one, which on a 32-core
  // machine is 31 workers and up to 620 connections. The server then refuses
  // whichever worker happens to ask while it is saturated, so a different and
  // entirely innocent suite fails on each run. Five consecutive runs, five
  // different victims, every one green in isolation.
  maxWorkers: 10,
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Creates ONE throwaway, fully-migrated Postgres database per run and points
  // DATABASE_URL at it, then drops it. A reachable Postgres is a hard
  // prerequisite of this suite — see jest.globalSetup.ts.
  globalSetup: '<rootDir>/jest.globalSetup.ts',
  globalTeardown: '<rootDir>/jest.globalTeardown.ts',
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
    // Same rationale for @oxyhq/core (getNormalizedUserHandle in did.service.ts,
    // User model, etc.) and @oxyhq/core/server (safeFetch/SsrfRejection): resolve
    // from source so api tests do not depend on a prior core build.
    '^@oxyhq/core/server$': '<rootDir>/../core/src/server/index.ts',
    '^@oxyhq/core$': '<rootDir>/../core/src/index.ts',
    '^@oxyhq/federation$': '<rootDir>/../federation/src/index.ts',
    '^@oxyhq/federation/node$': '<rootDir>/../federation/src/node/index.ts',
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