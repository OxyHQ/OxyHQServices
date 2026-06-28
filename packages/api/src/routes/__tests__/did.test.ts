/**
 * Route tests for the DID document endpoints (B2).
 *
 * Mounts the real `didRoutes` on a minimal Express app and exercises it over
 * node:http so the real `did.service` derivation runs. Only the data source
 * (`User.findById`) and `isValidObjectId` are stubbed (the global mongoose mock
 * cannot load the real model/validation).
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { ec as EC } from 'elliptic';

const mockFindById = jest.fn();

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...args: unknown[]) => mockFindById(...args) },
  default: { findById: (...args: unknown[]) => mockFindById(...args) },
}));

jest.mock('../../utils/validation', () => ({
  isValidObjectId: (id: string) => /^[a-f0-9]{24}$/i.test(id),
}));

// The DID route reads the active UserNode (F5a) to derive its #oxy-node service
// entry. Mock the service so no node is active here and the real UserNode model
// never loads under the global mongoose mock.
jest.mock('../../services/nodeRegistry.service', () => ({
  getUserNode: jest.fn(() => Promise.resolve(null)),
  materializeNodeFromRecord: jest.fn(),
  removeNode: jest.fn(),
  probeLiveness: jest.fn(),
  sweepNodeLiveness: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import didRoutes from '../did';

const ec = new EC('secp256k1');
const PUBLIC_KEY = ec.genKeyPair().getPublic('hex');
const USER_ID = '507f1f77bcf86cd799439011';

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

function selectLean(doc: unknown) {
  return { select: () => ({ lean: () => Promise.resolve(doc) }) };
}

async function get(server: http.Server, path: string): Promise<RawResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: address.port, path }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: raw.length > 0 ? JSON.parse(raw) : {},
        });
      });
    }).on('error', reject);
  });
}

let server: http.Server;
const ORIGINAL_OXY_PUBLIC_KEY = process.env.OXY_PUBLIC_KEY;

beforeAll((done) => {
  const app = express();
  app.use('/', didRoutes);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  mockFindById.mockReset();
});

afterEach(() => {
  if (ORIGINAL_OXY_PUBLIC_KEY === undefined) {
    delete process.env.OXY_PUBLIC_KEY;
  } else {
    process.env.OXY_PUBLIC_KEY = ORIGINAL_OXY_PUBLIC_KEY;
  }
});

describe('GET /u/:userId/did.json', () => {
  it('serves a self-sovereign DID document with JSON + CORS + cache headers', async () => {
    mockFindById.mockReturnValueOnce(selectLean({
      _id: USER_ID,
      publicKey: PUBLIC_KEY,
      username: 'nate',
      authMethods: [{ type: 'identity', metadata: { publicKey: PUBLIC_KEY } }],
      verifiedDomains: [],
      type: 'local',
    }));

    const res = await get(server, `/u/${USER_ID}/did.json`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.body.id).toBe(`did:web:oxy.so:u:${USER_ID}`);
    expect(res.body.controller).toEqual([`did:web:oxy.so:u:${USER_ID}`, 'did:web:oxy.so']);
    const vms = res.body.verificationMethod as Array<{ publicKeyHex: string }>;
    expect(vms[0]?.publicKeyHex).toBe(PUBLIC_KEY);
  });

  it('serves a custodial DID document controlled solely by Oxy', async () => {
    process.env.OXY_PUBLIC_KEY = ec.genKeyPair().getPublic('hex');
    mockFindById.mockReturnValueOnce(selectLean({
      _id: USER_ID,
      username: 'paula',
      authMethods: [{ type: 'password', metadata: { email: 'paula@oxy.so' } }],
      verifiedDomains: [],
      type: 'local',
    }));

    const res = await get(server, `/u/${USER_ID}/did.json`);

    expect(res.status).toBe(200);
    expect(res.body.controller).toEqual(['did:web:oxy.so']);
  });

  it('returns 404 for an invalid ObjectId', async () => {
    const res = await get(server, '/u/not-an-id/did.json');
    expect(res.status).toBe(404);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('returns 404 when the user does not exist', async () => {
    mockFindById.mockReturnValueOnce(selectLean(null));
    const res = await get(server, `/u/${USER_ID}/did.json`);
    expect(res.status).toBe(404);
  });
});

describe('GET /.well-known/did.json', () => {
  it('serves the Oxy organisation DID document with CORS', async () => {
    const res = await get(server, '/.well-known/did.json');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.body.id).toBe('did:web:oxy.so');
    expect(res.body.controller).toEqual(['did:web:oxy.so']);
  });
});

describe('DID_WEB_DOMAIN override — anchored at api.oxy.so', () => {
  // The DID-web domain is captured at module-load time, so the routes (and the
  // did.service they depend on) must be re-required under a fresh registry with
  // the override env set, then mounted on their own server.
  const ORIGINAL_DID_WEB_DOMAIN = process.env.DID_WEB_DOMAIN;
  let overrideServer: http.Server;

  beforeAll(async () => {
    process.env.DID_WEB_DOMAIN = 'api.oxy.so';
    let freshRoutes: typeof import('../did').default | undefined;
    await jest.isolateModulesAsync(async () => {
      freshRoutes = (await import('../did')).default;
    });
    if (!freshRoutes) {
      throw new Error('did routes failed to load under isolateModules');
    }
    const app = express();
    app.use('/', freshRoutes);
    await new Promise<void>((resolve) => {
      overrideServer = app.listen(0, '127.0.0.1', () => resolve());
    });
  });

  afterAll((done) => {
    if (ORIGINAL_DID_WEB_DOMAIN === undefined) {
      delete process.env.DID_WEB_DOMAIN;
    } else {
      process.env.DID_WEB_DOMAIN = ORIGINAL_DID_WEB_DOMAIN;
    }
    overrideServer.close(done);
  });

  it('serves a user DID document anchored at did:web:api.oxy.so with federation URLs on oxy.so', async () => {
    mockFindById.mockReturnValueOnce(selectLean({
      _id: USER_ID,
      publicKey: PUBLIC_KEY,
      username: 'nate',
      authMethods: [{ type: 'identity', metadata: { publicKey: PUBLIC_KEY } }],
      verifiedDomains: [],
      type: 'local',
    }));

    const res = await get(overrideServer, `/u/${USER_ID}/did.json`);
    const did = `did:web:api.oxy.so:u:${USER_ID}`;

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(did);
    expect(res.body.controller).toEqual([did, 'did:web:api.oxy.so']);
    const vms = res.body.verificationMethod as Array<{ id: string }>;
    expect(vms[0]?.id).toBe(`${did}#key-1`);
    const services = res.body.service as Array<{ id: string; type: string; serviceEndpoint: string }>;
    expect(services.map((s) => s.id)).toEqual([`${did}#oxy-api`, `${did}#profile`]);
    // Federation-anchored endpoint + handles stay on the federation apex.
    expect(services).toContainEqual({ id: `${did}#oxy-api`, type: 'OxyApiService', serviceEndpoint: 'https://api.oxy.so' });
    const alsoKnownAs = res.body.alsoKnownAs as string[];
    expect(alsoKnownAs).toContain('acct:nate@oxy.so');
    expect(alsoKnownAs).toContain('https://oxy.so/@nate');
  });

  it('serves the Oxy organisation DID document anchored at did:web:api.oxy.so', async () => {
    const res = await get(overrideServer, '/.well-known/did.json');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('did:web:api.oxy.so');
    expect(res.body.controller).toEqual(['did:web:api.oxy.so']);
  });
});
