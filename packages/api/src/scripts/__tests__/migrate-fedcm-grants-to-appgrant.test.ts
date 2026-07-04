/**
 * migrate-fedcm-grants-to-appgrant — pure mapping helpers.
 *
 * Covers the FedCMGrant → AppGrant classification: third-party origins migrate,
 * trusted apps are skipped (auto-approved), and origins no Application owns are
 * unresolved. The mongoose-backed `migrate()`/`main()` orchestration is a
 * one-shot ECS script and is not exercised here.
 */

import { ObjectId } from 'bson';

// A mongoose mock complete enough for the script's model files + the inline
// legacy schema to EVALUATE at import (Schema.Types.ObjectId, .index()), so the
// pure helpers can be imported. `require.main === module` is false under jest,
// so `main()` never runs.
jest.mock('mongoose', () => {
  const { ObjectId: BsonObjectId } = jest.requireActual('bson');
  const schemaInstance = { pre: jest.fn(), post: jest.fn(), index: jest.fn(), virtual: jest.fn(() => ({ get: jest.fn() })) };
  const Schema: jest.Mock & { Types?: unknown } = jest.fn(() => schemaInstance);
  Schema.Types = { ObjectId: BsonObjectId };
  const m: Record<string, unknown> = {
    models: {},
    model: jest.fn(() => ({ find: jest.fn(), updateOne: jest.fn() })),
    Schema,
    Types: { ObjectId: BsonObjectId },
    connect: jest.fn(),
    connection: { close: jest.fn() },
  };
  m.default = m;
  m.__esModule = true;
  return m;
});

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { buildOriginToApp, classifyFedCMGrant, type AppOriginRow } from '../migrate-fedcm-grants-to-appgrant';

const thirdPartyId = new ObjectId();
const trustedId = new ObjectId();

const apps: AppOriginRow[] = [
  { _id: thirdPartyId, redirectUris: ['https://third.example/cb', 'https://third.example/cb2'], type: 'third_party' },
  { _id: trustedId, redirectUris: ['https://first.oxy.so/cb'], type: 'first_party' },
];

describe('buildOriginToApp', () => {
  it('maps each normalised redirect origin to its application + trust flag (first wins)', () => {
    const map = buildOriginToApp(apps);
    expect(map.get('https://third.example')).toEqual({ applicationId: thirdPartyId, trusted: false });
    expect(map.get('https://first.oxy.so')).toEqual({ applicationId: trustedId, trusted: true });
    // Two redirectUris on the same origin collapse to one entry.
    expect(map.size).toBe(2);
  });
});

describe('classifyFedCMGrant', () => {
  const map = buildOriginToApp(apps);

  it('MIGRATES a third-party origin to its applicationId', () => {
    expect(classifyFedCMGrant('https://third.example', map)).toEqual({ kind: 'migrate', applicationId: thirdPartyId });
  });

  it('SKIPS a trusted (first-party) origin — auto-approved, no grant needed', () => {
    expect(classifyFedCMGrant('https://first.oxy.so', map)).toEqual({ kind: 'skip_trusted' });
  });

  it('marks an origin no Application owns as unresolved', () => {
    expect(classifyFedCMGrant('https://unknown.example', map)).toEqual({ kind: 'unresolved' });
  });

  it('normalises the origin before matching (path/case ignored)', () => {
    expect(classifyFedCMGrant('HTTPS://Third.example/some/path', map)).toEqual({ kind: 'migrate', applicationId: thirdPartyId });
  });
});
