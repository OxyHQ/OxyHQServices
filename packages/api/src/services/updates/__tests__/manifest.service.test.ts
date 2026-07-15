/**
 * Manifest-service tests: the golden multipart fixture (part headers, UUID id,
 * verifiable signature) and the full decision matrix (manifest / noUpdate when
 * current==head / RTE precedence + loop guard / rollout 0-100-no-key / protocol-0
 * 204 / unknown channel). Models are mocked; the signing service is REAL (a real
 * keypair + certificate), so every signature assertion is genuine.
 */

import crypto from 'crypto';
import {
  generateKeyPair,
  generateSelfSignedCodeSigningCertificate,
  convertCertificateToCertificatePEM,
  convertKeyPairToPEM,
} from '@expo/code-signing-certificates';

const mockChannelFindOne = jest.fn();
const mockAppUpdateFind = jest.fn();

jest.mock('../../../models/UpdateChannel', () => ({
  __esModule: true,
  UpdateChannel: { findOne: (...args: unknown[]) => mockChannelFindOne(...args) },
  UPDATE_PLATFORMS: ['ios', 'android'],
}));
jest.mock('../../../models/AppUpdate', () => ({
  __esModule: true,
  AppUpdate: { find: (...args: unknown[]) => mockAppUpdateFind(...args) },
}));

import {
  buildManifestResponse,
  isInRollout,
  type ManifestRequest,
} from '../manifest.service';
import { resetSigningKeyCache } from '../signing.service';

// --- Real signing material ---
const keyPair = generateKeyPair();
const notBefore = new Date();
const notAfter = new Date();
notAfter.setFullYear(notAfter.getFullYear() + 1);
const certificate = generateSelfSignedCodeSigningCertificate({
  keyPair,
  validityNotBefore: notBefore,
  validityNotAfter: notAfter,
  commonName: 'Oxy Updates Test',
});
const { privateKeyPEM } = convertKeyPairToPEM(keyPair);
const publicKey = new crypto.X509Certificate(
  convertCertificateToCertificatePEM(certificate)
).publicKey;

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

interface ParsedPart {
  headers: Record<string, string>;
  body: string;
}

/** Split a multipart/mixed body into its parts (headers + raw body string). */
function parseMultipart(contentType: string, body: Buffer): ParsedPart[] {
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) throw new Error(`no boundary in ${contentType}`);
  const boundary = boundaryMatch[1];
  const raw = body.toString('utf8');
  const segments = raw.split(`--${boundary}`).slice(1, -1);
  return segments.map((segment) => {
    const trimmed = segment.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const split = trimmed.indexOf('\r\n\r\n');
    const headerBlock = trimmed.slice(0, split);
    const partBody = trimmed.slice(split + 4);
    const headers: Record<string, string> = {};
    for (const line of headerBlock.split('\r\n')) {
      const colon = line.indexOf(':');
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    return { headers, body: partBody };
  });
}

function verifyPartSignature(part: ParsedPart): boolean {
  const header = part.headers['expo-signature'];
  const match = header?.match(/^sig="([^"]+)", keyid="([^"]+)"$/);
  if (!match) return false;
  return crypto
    .createVerify('RSA-SHA256')
    .update(Buffer.from(part.body, 'utf8'))
    .verify(publicKey, Buffer.from(match[1], 'base64'));
}

function makeUpdate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    updateId: crypto.randomUUID(),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    runtimeVersion: '1.0.0',
    platform: 'ios',
    status: 'published',
    rolloutPercent: 100,
    launchAsset: { sha256: SHA_A, key: 'bundle-key', contentType: 'application/javascript' },
    assets: [{ sha256: SHA_B, key: 'img-key', contentType: 'image/png', fileExtension: '.png' }],
    metadata: {},
    extra: { expoClient: { name: 'demo', slug: 'demo' } },
    ...overrides,
  };
}

/** Mock `AppUpdate.find(...).sort(...).limit(...)` to resolve `updates`. */
function mockHeadCandidates(updates: unknown[]): void {
  mockAppUpdateFind.mockReturnValue({
    sort: () => ({ limit: () => Promise.resolve(updates) }),
  });
}

function baseRequest(overrides: Partial<ManifestRequest> = {}): ManifestRequest {
  return {
    applicationId: 'app1',
    platform: 'ios',
    runtimeVersion: '1.0.0',
    channelName: 'production',
    protocolVersion: 1,
    expectSignature: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.UPDATES_CODE_SIGNING_PRIVATE_KEY = Buffer.from(privateKeyPEM, 'utf8').toString('base64');
  resetSigningKeyCache();
  // Default: channel exists with no rollback directives.
  mockChannelFindOne.mockResolvedValue({
    _id: { toString: () => 'chan1' },
    rollbacksToEmbedded: [],
  });
});

describe('buildManifestResponse — golden manifest', () => {
  test('serves a signed multipart manifest with a UUID id and CDN asset urls', async () => {
    const update = makeUpdate();
    mockHeadCandidates([update]);

    const response = await buildManifestResponse(baseRequest());

    expect(response.status).toBe(200);
    expect(response.headers['expo-protocol-version']).toBe('1');
    expect(response.headers['expo-sfv-version']).toBe('0');
    expect(response.headers['cache-control']).toBe('private, max-age=0');
    expect(response.headers['content-type']).toMatch(/^multipart\/mixed; boundary=/);

    const parts = parseMultipart(response.headers['content-type'], response.body as Buffer);
    const manifestPart = parts.find((p) => p.headers['content-disposition']?.includes('name="manifest"'));
    const extensionsPart = parts.find((p) =>
      p.headers['content-disposition']?.includes('name="extensions"')
    );

    expect(manifestPart).toBeDefined();
    expect(extensionsPart).toBeDefined();
    expect(manifestPart?.headers['content-type']).toContain('application/json');
    // Manifest part is signed and the signature verifies over its exact bytes.
    expect(verifyPartSignature(manifestPart as ParsedPart)).toBe(true);

    const manifest = JSON.parse((manifestPart as ParsedPart).body);
    expect(manifest.id).toBe(update.updateId);
    expect(manifest.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(manifest.runtimeVersion).toBe('1.0.0');
    expect(manifest.createdAt).toBe('2026-07-01T00:00:00.000Z');
    expect(manifest.extra).toEqual({ expoClient: { name: 'demo', slug: 'demo' } });

    // Launch asset omits fileExtension; url points at cloud.oxy.so.
    expect(manifest.launchAsset.url).toBe(`https://cloud.oxy.so/updates/assets/${SHA_A}`);
    expect(manifest.launchAsset.fileExtension).toBeUndefined();
    expect(manifest.launchAsset.contentType).toBe('application/javascript');
    // Regular asset keeps fileExtension and carries a base64url hash.
    expect(manifest.assets[0].url).toBe(`https://cloud.oxy.so/updates/assets/${SHA_B}`);
    expect(manifest.assets[0].fileExtension).toBe('.png');
    expect(manifest.assets[0].hash).toBe(
      Buffer.from(SHA_B, 'hex').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    );

    // Extensions part is present and unsigned.
    expect(JSON.parse((extensionsPart as ParsedPart).body)).toEqual({ assetRequestHeaders: {} });
    expect(extensionsPart?.headers['expo-signature']).toBeUndefined();
  });

  test('omits signatures when the client did not request one', async () => {
    mockHeadCandidates([makeUpdate()]);
    const response = await buildManifestResponse(baseRequest({ expectSignature: false }));
    const parts = parseMultipart(response.headers['content-type'], response.body as Buffer);
    const manifestPart = parts.find((p) => p.headers['content-disposition']?.includes('name="manifest"'));
    expect(manifestPart?.headers['expo-signature']).toBeUndefined();
  });
});

describe('buildManifestResponse — decision matrix', () => {
  test('current == head → noUpdateAvailable directive (signed)', async () => {
    const update = makeUpdate();
    mockHeadCandidates([update]);

    const response = await buildManifestResponse(baseRequest({ currentUpdateId: update.updateId }));
    const parts = parseMultipart(response.headers['content-type'], response.body as Buffer);
    const directive = parts.find((p) => p.headers['content-disposition']?.includes('name="directive"'));
    expect(directive).toBeDefined();
    expect(JSON.parse((directive as ParsedPart).body)).toEqual({ type: 'noUpdateAvailable' });
    expect(verifyPartSignature(directive as ParsedPart)).toBe(true);
  });

  test('active rollback-to-embedded takes precedence → rollBackToEmbedded directive', async () => {
    mockChannelFindOne.mockResolvedValue({
      _id: { toString: () => 'chan1' },
      rollbacksToEmbedded: [
        { runtimeVersion: '1.0.0', platform: 'ios', commitTime: new Date('2026-06-01T00:00:00.000Z') },
      ],
    });

    const response = await buildManifestResponse(baseRequest());
    // Head resolution must not even be consulted when an RTE directive applies.
    expect(mockAppUpdateFind).not.toHaveBeenCalled();

    const parts = parseMultipart(response.headers['content-type'], response.body as Buffer);
    const directive = parts.find((p) => p.headers['content-disposition']?.includes('name="directive"'));
    expect(JSON.parse((directive as ParsedPart).body)).toEqual({
      type: 'rollBackToEmbedded',
      parameters: { commitTime: '2026-06-01T00:00:00.000Z' },
    });
    expect(verifyPartSignature(directive as ParsedPart)).toBe(true);
  });

  test('rollback-to-embedded loop guard: client already on embedded → noUpdateAvailable', async () => {
    mockChannelFindOne.mockResolvedValue({
      _id: { toString: () => 'chan1' },
      rollbacksToEmbedded: [
        { runtimeVersion: '1.0.0', platform: 'ios', commitTime: new Date('2026-06-01T00:00:00.000Z') },
      ],
    });

    const response = await buildManifestResponse(
      baseRequest({ currentUpdateId: 'embedded-1', embeddedUpdateId: 'embedded-1' })
    );
    const parts = parseMultipart(response.headers['content-type'], response.body as Buffer);
    const directive = parts.find((p) => p.headers['content-disposition']?.includes('name="directive"'));
    expect(JSON.parse((directive as ParsedPart).body)).toEqual({ type: 'noUpdateAvailable' });
  });

  test('unknown channel → noUpdateAvailable directive', async () => {
    mockChannelFindOne.mockResolvedValue(null);
    const response = await buildManifestResponse(baseRequest({ channelName: 'nope' }));
    const parts = parseMultipart(response.headers['content-type'], response.body as Buffer);
    const directive = parts.find((p) => p.headers['content-disposition']?.includes('name="directive"'));
    expect(JSON.parse((directive as ParsedPart).body)).toEqual({ type: 'noUpdateAvailable' });
  });

  test('no published update → noUpdateAvailable directive', async () => {
    mockHeadCandidates([]);
    const response = await buildManifestResponse(baseRequest());
    const parts = parseMultipart(response.headers['content-type'], response.body as Buffer);
    const directive = parts.find((p) => p.headers['content-disposition']?.includes('name="directive"'));
    expect(JSON.parse((directive as ParsedPart).body)).toEqual({ type: 'noUpdateAvailable' });
  });

  test('partial-rollout head the device is OUT of → falls back to the previous full-rollout update', async () => {
    const head = makeUpdate({ rolloutPercent: 0 }); // 0% → nobody is in
    const previous = makeUpdate({ rolloutPercent: 100 });
    mockHeadCandidates([head, previous]);

    const response = await buildManifestResponse(baseRequest({ deviceKey: 'device-xyz' }));
    const parts = parseMultipart(response.headers['content-type'], response.body as Buffer);
    const manifestPart = parts.find((p) => p.headers['content-disposition']?.includes('name="manifest"'));
    const manifest = JSON.parse((manifestPart as ParsedPart).body);
    expect(manifest.id).toBe(previous.updateId);
  });

  test('protocol 0 directive decision → 204 No Content', async () => {
    const update = makeUpdate();
    mockHeadCandidates([update]);
    const response = await buildManifestResponse(
      baseRequest({ protocolVersion: 0, currentUpdateId: update.updateId })
    );
    expect(response.status).toBe(204);
    expect(response.body).toBeUndefined();
  });

  test('protocol 0 still serves a real manifest normally', async () => {
    const update = makeUpdate();
    mockHeadCandidates([update]);
    const response = await buildManifestResponse(baseRequest({ protocolVersion: 0 }));
    expect(response.status).toBe(200);
    const parts = parseMultipart(response.headers['content-type'], response.body as Buffer);
    expect(parts.find((p) => p.headers['content-disposition']?.includes('name="manifest"'))).toBeDefined();
  });

  test('requesting a signature with no key configured → surfaces CodeSigningNotConfiguredError', async () => {
    delete process.env.UPDATES_CODE_SIGNING_PRIVATE_KEY;
    resetSigningKeyCache();
    mockHeadCandidates([makeUpdate()]);
    await expect(buildManifestResponse(baseRequest({ expectSignature: true }))).rejects.toThrow(
      /not configured/i
    );
  });
});

describe('isInRollout', () => {
  test('100% is always in; 0% is never in', () => {
    expect(isInRollout('u1', 100, undefined)).toBe(true);
    expect(isInRollout('u1', 100, 'dev')).toBe(true);
    expect(isInRollout('u1', 0, 'dev')).toBe(false);
  });

  test('a partial rollout with no device key is out', () => {
    expect(isInRollout('u1', 50, undefined)).toBe(false);
  });

  test('bucketing is deterministic per (update, device)', () => {
    const a = isInRollout('update-1', 50, 'device-1');
    const b = isInRollout('update-1', 50, 'device-1');
    expect(a).toBe(b);
  });
});
