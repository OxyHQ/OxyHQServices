/**
 * GET /search public-projection coverage.
 *
 * `/search` is mounted with NO auth and NO CSRF (`server.ts`), so every field it
 * emits is world-readable. It once shipped an exclusion `$project`
 * (`{ password: 0, refreshToken: 0, ... }`), which put `email`, `publicKey` and
 * the full `privacySettings` object on that public response.
 *
 * The sibling suite (`search.test.ts`) could not catch that: it stubs
 * `formatUserResponse` down to `{ id }` and its `User.aggregate` mock ignores
 * the `$project` stage entirely. This suite deliberately does the opposite —
 * it uses the REAL serializer and APPLIES the route's own `$project` with
 * MongoDB's semantics — so it fails if the projection ever regresses to a
 * denylist, or if a private path is added to the public projection.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { Types } from 'mongoose';

const mockUserAggregate = jest.fn();

jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    aggregate: (...args: unknown[]) => mockUserAggregate(...args),
  },
}));

import searchRouter from '../search';
import { errorHandler } from '../../middleware/errorHandler';

/** A complete User document, as it actually sits in Mongo. */
const STORED_USER = {
  _id: new Types.ObjectId(),
  username: 'nate',
  email: 'nate@oxy.so',
  password: '$2b$10$hash',
  refreshToken: 'rt_secret',
  publicKey: '048295c46ffc47451',
  phone: '+34600000000',
  hashedEmail: 'deadbeef',
  hashedPhone: 'cafebabe',
  themePreference: { mode: 'dark', colorPreset: 'orange' },
  name: { first: 'Nate', last: 'Isern', full: 'Nate Isern' },
  avatar: 'file_123',
  color: 'orange',
  bio: 'hello',
  description: 'desc',
  links: ['https://oxy.so'],
  linksMetadata: [{ url: 'https://oxy.so' }],
  verified: true,
  type: 'local',
  privacySettings: {
    isPrivateAccount: false,
    fediverseSharing: true,
    discoverableByEmail: false,
    biometricLogin: false,
  },
  createdAt: '2026-02-03T10:08:23.997Z',
  updatedAt: '2026-07-30T18:20:41.852Z',
} as const;

/** Every path on STORED_USER that must NEVER reach an unauthenticated response. */
const PRIVATE_PATHS = [
  'email',
  'password',
  'refreshToken',
  'publicKey',
  'phone',
  'hashedEmail',
  'hashedPhone',
  'themePreference',
] as const;

/**
 * Applies a `$project` stage the way MongoDB does — supporting BOTH inclusion
 * and exclusion form, so a regression to a denylist is reproduced faithfully
 * rather than assumed away.
 */
function applyProjection(
  doc: Record<string, unknown>,
  projection: Record<string, unknown>,
): Record<string, unknown> {
  const entries = Object.entries(projection).filter(([key]) => key !== '_id');
  const isExclusion = entries.length > 0 && entries.every(([, value]) => value === 0 || value === false);

  if (isExclusion) {
    const out = { ...doc };
    for (const [key] of entries) {
      delete out[key];
    }
    return out;
  }

  const out: Record<string, unknown> = { _id: doc._id };
  for (const [path] of entries) {
    if (path.includes('.')) {
      const [head, leaf] = path.split('.');
      const parent = doc[head];
      if (parent && typeof parent === 'object') {
        const nested = (out[head] as Record<string, unknown>) ?? {};
        nested[leaf] = (parent as Record<string, unknown>)[leaf];
        out[head] = nested;
      }
    } else if (path in doc) {
      out[path] = doc[path];
    }
  }
  return out;
}

function requestJson(
  server: http.Server,
  path: string,
): Promise<{ status: number; raw: string; body: { users?: Array<Record<string, unknown>> } }> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request({ method: 'GET', host: '127.0.0.1', port: address.port, path }, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, raw, body: raw.length > 0 ? JSON.parse(raw) : {} });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(searchRouter);
  app.use(errorHandler);
  server = app.listen(0, done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  // Run the route's OWN $project against the full stored document.
  mockUserAggregate.mockImplementation((pipeline: Array<Record<string, unknown>>) => {
    const projection = pipeline.find((stage) => '$project' in stage)?.$project as
      | Record<string, unknown>
      | undefined;
    if (!projection) {
      throw new Error('GET /search pipeline has no $project stage — the public row is unprojected');
    }
    return Promise.resolve([applyProjection({ ...STORED_USER }, projection)]);
  });
});

describe('GET /search public projection', () => {
  it('never emits a private field on the unauthenticated response', async () => {
    const res = await requestJson(server, '/?query=nate&type=users&page=1&limit=10');

    expect(res.status).toBe(200);
    const user = res.body.users?.[0];
    expect(user).toBeDefined();

    for (const path of PRIVATE_PATHS) {
      expect(user).not.toHaveProperty(path);
    }
    // Guard the serialized bytes too: a private value must not survive under any
    // key, including one a future serializer might rename it to.
    expect(res.raw).not.toContain('nate@oxy.so');
    expect(res.raw).not.toContain('rt_secret');
    expect(res.raw).not.toContain('048295c46ffc47451');
    expect(res.raw).not.toContain('+34600000000');
  });

  it('still returns the fields the search row renders', async () => {
    const res = await requestJson(server, '/?query=nate&type=users&page=1&limit=10');
    const user = res.body.users?.[0] as Record<string, unknown>;

    expect(user.id).toBe(STORED_USER._id.toString());
    expect(user.username).toBe('nate');
    expect(user.avatar).toBe('file_123');
    expect(user.color).toBe('orange');
    expect(user.bio).toBe('hello');
    expect(user.description).toBe('desc');
    expect(user.verified).toBe(true);
    expect(user.links).toEqual(['https://oxy.so']);
    expect(user.name).toMatchObject({ first: 'Nate', last: 'Isern' });
    expect(user.createdAt).toBe(STORED_USER.createdAt);
  });

  it('exposes only the public fediverseSharing leaf of privacySettings', async () => {
    const res = await requestJson(server, '/?query=nate&type=users&page=1&limit=10');
    const user = res.body.users?.[0] as Record<string, unknown>;

    expect(user.privacySettings).toEqual({ fediverseSharing: true });
  });

  it('strips the native-first pipeline sort keys', async () => {
    const res = await requestJson(server, '/?query=nate&type=users&page=1&limit=10');
    const user = res.body.users?.[0];

    expect(user).not.toHaveProperty('_nativePriority');
    expect(user).not.toHaveProperty('_reputationRank');
  });
});
