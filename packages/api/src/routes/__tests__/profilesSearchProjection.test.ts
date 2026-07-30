/**
 * GET /profiles/search public-projection coverage.
 *
 * `/profiles/search` is a public people-search surface (no auth on the route).
 * It once shipped the same exclusion `$project` as the leaked `GET /search`
 * (`{ password: 0, refreshToken: 0, ... }`), which loaded full user documents
 * into the aggregation pipeline and relied on the serializer to drop private
 * fields. The sibling suite (`profilesSearch.test.ts`) stubs
 * `userService.formatUserResponse` down to `{ id, username }` and its
 * `User.aggregate` mock ignores the `$project` stage entirely.
 *
 * This suite uses the REAL `userService.formatUserResponse` and APPLIES the
 * route's own `$project` with MongoDB's semantics — so it fails if the
 * projection ever regresses to a denylist, or if a private path is added to the
 * public projection.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

jest.mock('mongoose', () => jest.requireActual('mongoose'));
import { Types } from 'mongoose';

const mockUserAggregate = jest.fn();
const mockFollowAggregate = jest.fn();
const mockResolveAndUpsert = jest.fn();
const mockIsFediverseHandle = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/optionalAuth', () => ({
  optionalUserOrServiceAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  resolveViewerId: (): string | undefined => undefined,
}));
jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../services/federation.service', () => ({
  federationService: { resolveAndUpsert: (...args: unknown[]) => mockResolveAndUpsert(...args) },
  isFediverseHandle: (...args: unknown[]) => mockIsFediverseHandle(...args),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../models/Follow', () => ({
  __esModule: true,
  FollowType: { USER: 'user', HASHTAG: 'hashtag', TOPIC: 'topic' },
  default: {
    aggregate: (...args: unknown[]) => mockFollowAggregate(...args),
  },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    aggregate: (...args: unknown[]) => mockUserAggregate(...args),
  },
}));

import profilesRouter from '../profiles';
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
): Promise<{ status: number; raw: string; body: { data?: Array<Record<string, unknown>> } }> {
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
  app.use('/profiles', profilesRouter);
  app.use(errorHandler);
  server = app.listen(0, done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockIsFediverseHandle.mockReturnValue(false);
  mockResolveAndUpsert.mockResolvedValue(null);
  mockFollowAggregate.mockResolvedValue([]);

  mockUserAggregate.mockImplementation((pipeline: Array<Record<string, unknown>>) => {
    const facetStage = pipeline.find((stage) => '$facet' in stage) as
      | { $facet?: { profiles?: Array<Record<string, unknown>> } }
      | undefined;
    const profilesPipeline = facetStage?.$facet?.profiles ?? [];
    const projection = profilesPipeline.find((stage) => '$project' in stage)?.$project as
      | Record<string, unknown>
      | undefined;
    if (!projection) {
      throw new Error('GET /profiles/search pipeline has no $project stage — the public row is unprojected');
    }
    const projected = applyProjection({ ...STORED_USER }, projection);
    return Promise.resolve([
      {
        profiles: [projected],
        totalCount: [{ count: 1 }],
      },
    ]);
  });
});

describe('GET /profiles/search public projection', () => {
  it('never emits a private field on the unauthenticated response', async () => {
    const res = await requestJson(server, '/profiles/search?query=nate&limit=10&offset=0');

    expect(res.status).toBe(200);
    const profile = res.body.data?.[0];
    expect(profile).toBeDefined();

    for (const path of PRIVATE_PATHS) {
      expect(profile).not.toHaveProperty(path);
    }
    expect(res.raw).not.toContain('nate@oxy.so');
    expect(res.raw).not.toContain('rt_secret');
    expect(res.raw).not.toContain('048295c46ffc47451');
    expect(res.raw).not.toContain('+34600000000');
  });

  it('still returns the fields the search row renders', async () => {
    const res = await requestJson(server, '/profiles/search?query=nate&limit=10&offset=0');
    const profile = res.body.data?.[0] as Record<string, unknown>;

    expect(profile.id).toBe(STORED_USER._id.toString());
    expect(profile.username).toBe('nate');
    expect(profile.avatar).toBe('file_123');
    expect(profile.color).toBe('orange');
    expect(profile.bio).toBe('hello');
    expect(profile.description).toBe('desc');
    expect(profile.verified).toBe(true);
    expect(profile.links).toEqual(['https://oxy.so']);
    expect(profile.name).toMatchObject({ first: 'Nate', last: 'Isern' });
    expect(profile.createdAt).toBe(STORED_USER.createdAt);
    expect(profile._count).toEqual({ followers: 0, following: 0 });
  });

  it('exposes only the public fediverseSharing leaf as fediverseSharing', async () => {
    const res = await requestJson(server, '/profiles/search?query=nate&limit=10&offset=0');
    const profile = res.body.data?.[0] as Record<string, unknown>;

    expect(profile.fediverseSharing).toBe(true);
    expect(profile).not.toHaveProperty('privacySettings');
  });

  it('strips the native-first pipeline sort keys', async () => {
    const res = await requestJson(server, '/profiles/search?query=nate&limit=10&offset=0');
    const profile = res.body.data?.[0];

    expect(profile).not.toHaveProperty('_nativePriority');
    expect(profile).not.toHaveProperty('_reputationRank');
  });
});
