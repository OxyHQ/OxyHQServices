/**
 * /federation/sign + /federation/public-key contract & security tests.
 *
 * Covers the sign-on-behalf trust boundary:
 *  - /sign happy path returns a base64 signature that verifies against the
 *    PUBLIC key (real RSA round-trip).
 *  - /sign rejects a missing federation:write scope (403).
 *  - /sign rejects a keyId whose host is not one of the credential's registered
 *    domains (403).
 *  - /sign rejects a non-existent key pair (404).
 *  - /sign rejects a signingString that does not begin with "(request-target):"
 *    (400).
 *  - /public-key returns { keyId, publicKeyPem } and NEVER privateKeyPem.
 *  - /public-key rejects a domain not registered for the credential (403).
 *
 * The router is mounted on a minimal Express app and exercised via node:http
 * round-trips so the real middleware chain (serviceAuthMiddleware → validate →
 * handler → errorHandler) runs.
 */

import express from 'express';
import http from 'http';
import crypto from 'crypto';
import { AddressInfo } from 'net';

const mockServiceAuthMiddleware = jest.fn();
const mockGetUserPublicKey = jest.fn();
const mockSignWithKeyId = jest.fn();
const mockGetAllowedDomains = jest.fn();

jest.mock('../../middleware/auth', () => ({
  serviceAuthMiddleware: (...args: unknown[]) => mockServiceAuthMiddleware(...args),
}));

jest.mock('../../services/federation.service', () => ({
  __esModule: true,
  getUserPublicKey: (...args: unknown[]) => mockGetUserPublicKey(...args),
  signWithKeyId: (...args: unknown[]) => mockSignWithKeyId(...args),
}));

// The route resolves allowed domains through this cache; stub it so the test
// controls the credential→domain boundary directly without touching Mongo.
jest.mock('../../utils/credentialDomainCache', () => ({
  __esModule: true,
  default: {
    getAllowedDomains: (...args: unknown[]) => mockGetAllowedDomains(...args),
  },
}));

// Application is loaded by the (stubbed) cache loader only — provide a no-op so
// importing the route never reaches the mongoose mock.
jest.mock('../../models/Application', () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import federationRouter from '../federation';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: { error?: string; message?: string; data?: Record<string, unknown> };
}

async function requestJson(
  server: http.Server,
  method: string,
  path: string,
  payload?: unknown,
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const hasBody = method !== 'GET';
  const body = hasBody ? JSON.stringify(payload ?? {}) : '';
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: hasBody
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = raw.length > 0 ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode ?? 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    if (hasBody) req.write(body);
    req.end();
  });
}

const MENTION_DOMAIN = 'mention.earth';
const MENTION_KEY_ID = `https://${MENTION_DOMAIN}/ap/users/bob#main-key`;

let server: http.Server;
let publicKeyPem: string;
let privateKeyPem: string;

beforeAll((done) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  publicKeyPem = publicKey;
  privateKeyPem = privateKey;

  const app = express();
  app.use(express.json());
  app.use('/federation', federationRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();

  // Default: a Mention credential with federation:write scope.
  mockServiceAuthMiddleware.mockImplementation(
    (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
      req.serviceApp = {
        type: 'service',
        appId: 'app-mention',
        appName: 'Mention',
        credentialId: 'cred-1',
        scopes: ['federation:write'],
      };
      next();
    },
  );

  // Default: the credential is registered for mention.earth.
  mockGetAllowedDomains.mockResolvedValue(new Set([MENTION_DOMAIN]));

  // Default: signing produces a REAL signature with the test private key, so a
  // verifier holding the matching public key accepts it.
  mockSignWithKeyId.mockImplementation((_keyId: string, signingString: string) => {
    const signer = crypto.createSign('sha256');
    signer.update(signingString);
    signer.end();
    return Promise.resolve(signer.sign(privateKeyPem, 'base64'));
  });

  mockGetUserPublicKey.mockResolvedValue({ keyId: MENTION_KEY_ID, publicKeyPem });
});

describe('POST /federation/sign', () => {
  const signingString = [
    '(request-target): post /ap/users/alice/inbox',
    'host: mastodon.social',
    'date: Wed, 18 Jun 2026 00:00:00 GMT',
  ].join('\n');

  it('happy path: returns a base64 signature that verifies against the public key', async () => {
    const res = await requestJson(server, 'POST', '/federation/sign', {
      keyId: MENTION_KEY_ID,
      signingString,
    });

    expect(res.status).toBe(200);
    expect(res.body.data?.keyId).toBe(MENTION_KEY_ID);
    expect(res.body.data?.algorithm).toBe('rsa-sha256');
    const signature = res.body.data?.signature;
    expect(typeof signature).toBe('string');

    // Real RSA round-trip: the returned signature must verify under the public key.
    const verifier = crypto.createVerify('sha256');
    verifier.update(signingString);
    verifier.end();
    expect(verifier.verify(publicKeyPem, signature as string, 'base64')).toBe(true);

    // The private key is never disclosed.
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE KEY');
    expect(res.body.data).not.toHaveProperty('privateKeyPem');
  });

  it('rejects when the service token lacks federation:write scope (403)', async () => {
    mockServiceAuthMiddleware.mockImplementationOnce(
      (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
        req.serviceApp = {
          type: 'service',
          appId: 'app-mention',
          appName: 'Mention',
          credentialId: 'cred-1',
          scopes: [],
        };
        next();
      },
    );

    const res = await requestJson(server, 'POST', '/federation/sign', {
      keyId: MENTION_KEY_ID,
      signingString,
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/federation:write/i);
    expect(mockSignWithKeyId).not.toHaveBeenCalled();
  });

  it('rejects a keyId whose host is not a registered domain for the credential (403)', async () => {
    // Credential is only registered for mention.earth; signing an evil.example
    // keyId must be denied even with a valid scope.
    const res = await requestJson(server, 'POST', '/federation/sign', {
      keyId: 'https://evil.example/ap/users/bob#main-key',
      signingString,
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not authorised/i);
    expect(mockSignWithKeyId).not.toHaveBeenCalled();
  });

  it('rejects a non-existent key pair (404)', async () => {
    mockSignWithKeyId.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'POST', '/federation/sign', {
      keyId: MENTION_KEY_ID,
      signingString,
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no key pair/i);
  });

  it('rejects a signingString that does not begin with "(request-target):" (400)', async () => {
    const res = await requestJson(server, 'POST', '/federation/sign', {
      keyId: MENTION_KEY_ID,
      signingString: 'host: mastodon.social\ndate: Wed, 18 Jun 2026 00:00:00 GMT',
    });

    expect(res.status).toBe(400);
    expect(mockSignWithKeyId).not.toHaveBeenCalled();
  });

  it('rejects a keyId that does not end with #main-key (400)', async () => {
    const res = await requestJson(server, 'POST', '/federation/sign', {
      keyId: `https://${MENTION_DOMAIN}/ap/users/bob`,
      signingString,
    });

    expect(res.status).toBe(400);
    expect(mockSignWithKeyId).not.toHaveBeenCalled();
  });

  it('rejects an oversized signingString (400)', async () => {
    const huge = '(request-target): post /ap/inbox\n' + 'x'.repeat(5000);
    const res = await requestJson(server, 'POST', '/federation/sign', {
      keyId: MENTION_KEY_ID,
      signingString: huge,
    });

    expect(res.status).toBe(400);
    expect(mockSignWithKeyId).not.toHaveBeenCalled();
  });
});

describe('GET /federation/public-key/:username', () => {
  it('returns { keyId, publicKeyPem } and never privateKeyPem', async () => {
    const res = await requestJson(
      server,
      'GET',
      `/federation/public-key/bob?domain=${MENTION_DOMAIN}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data?.keyId).toBe(MENTION_KEY_ID);
    expect(res.body.data?.publicKeyPem).toBe(publicKeyPem);
    expect(res.body.data).not.toHaveProperty('privateKeyPem');
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE KEY');
    expect(mockGetUserPublicKey).toHaveBeenCalledWith('bob', MENTION_DOMAIN);
  });

  it('rejects a domain not registered for the credential (403)', async () => {
    const res = await requestJson(
      server,
      'GET',
      '/federation/public-key/bob?domain=evil.example',
    );

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not registered/i);
    expect(mockGetUserPublicKey).not.toHaveBeenCalled();
  });

  it('rejects a missing federation:write scope (403)', async () => {
    mockServiceAuthMiddleware.mockImplementationOnce(
      (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
        req.serviceApp = {
          type: 'service',
          appId: 'app-mention',
          appName: 'Mention',
          credentialId: 'cred-1',
          scopes: [],
        };
        next();
      },
    );

    const res = await requestJson(
      server,
      'GET',
      `/federation/public-key/bob?domain=${MENTION_DOMAIN}`,
    );

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/federation:write/i);
    expect(mockGetUserPublicKey).not.toHaveBeenCalled();
  });
});
