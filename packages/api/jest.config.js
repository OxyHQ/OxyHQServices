const { cpus, totalmem } = require('node:os');

// Every worker opens its OWN Postgres pool against the one test server. With
// `PG_MAX_POOL_SIZE = 8` (see `jest.globalSetup.ts`, where 8 is a floor set by
// the backfill's own copy concurrency), 10 workers ask for at most 80
// connections against a `max_connections` of 100 — under the ceiling with room
// for the migrator's own session and a psql.
//
// Unbounded, jest forks one worker per core minus one, which on a 32-core
// machine is 31 workers and up to 620 connections. The server then refuses
// whichever worker happens to ask while it is saturated, so a different and
// entirely innocent suite fails on each run. Five consecutive runs, five
// different victims, every one green in isolation.
const POSTGRES_WORKER_CEILING = 10;

// That ceiling has to LOWER the worker count and never raise it. Written as a
// bare `maxWorkers: 10` it did both, and on the machine CI actually runs on it
// raised it: a GitHub-hosted `ubuntu-latest` runner has 4 vCPUs and 16 GiB, so
// jest's own default there is 3 workers. Pinning 10 took the runner past its
// memory and the kernel brought it down mid-run — five consecutive red runs on
// `main`, each ending in `SIGTERM (Polite quit request)`, exit 143 and
// `The runner has received a shutdown signal`, with not one test result
// printed. That reads like a hung test rather than an exhausted machine, which
// is what made it expensive to place.
//
// Measured on this suite in a cgroup held to the runner's shape (4 CPUs,
// 16 GiB, no swap), peak ANONYMOUS bytes — page cache is reclaimable and does
// not push a cgroup into OOM, so only anon counts: 3 workers = 7.06 GiB,
// 10 workers = 13.68 GiB. Roughly a fixed 4.2 GiB for jest plus 0.95 GiB per
// worker, because ts-jest holds a TypeScript program per worker and
// `--coverage` instruments every file. 13.68 GiB does not fit in 16 GiB beside
// the runner agent and the mongo and postgis service containers; 7.06 GiB does.
const WORKER_BYTES = 1_000_000_000;
const JEST_BASE_BYTES = 4_500_000_000;
// A quarter of the machine left to the OS, docker and page cache.
const MEMORY_BUDGET_FRACTION = 0.75;

// The run has to be under all three ceilings, so take the smallest. On CI
// (4 vCPUs, 16 GiB) that is the CPU bound at 3; on a 32-core workstation it is
// the Postgres bound at 10, exactly as before. The memory bound only binds on a
// machine with many cores and little RAM per core, where the CPU bound alone
// would put us back where this started.
const MAX_WORKERS = Math.min(
  POSTGRES_WORKER_CEILING,
  Math.max(1, cpus().length - 1),
  Math.max(
    1,
    Math.floor((totalmem() * MEMORY_BUDGET_FRACTION - JEST_BASE_BYTES) / WORKER_BYTES)
  )
);

module.exports = {
  maxWorkers: MAX_WORKERS,
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
      // OFF, not `{ ignoreCodes: [...] }`. The two are not "the same setting
      // with a filter": `false` disables type-checking in the transform
      // entirely, while ANY object turns the full check ON and merely excludes
      // the listed codes. Narrowing it to silence the TS151002 config warning
      // therefore enabled type-checking across a suite that has never had it,
      // and 165 of 295 suites stopped running — TS2550 `Property 'cause' does
      // not exist on type 'Error'` (a `lib` question), TS2307 for
      // `@oxyhq/federation` (whose `dist` this job does not build), TS2339,
      // TS7006. None of them is a test failure; the suites never execute.
      //
      // `tsc --noEmit` is where this package's types are gated. Turning the
      // check on here as well is a defensible goal, but it is a real project —
      // those 165 suites have to be fixed first — not a side effect of quieting
      // a warning. The TS151002 line is noise on stderr and costs nothing.
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