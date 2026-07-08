/**
 * OAuth2 Authorization Code Service Tests (H6 regression coverage)
 *
 * Exercises:
 *  - happy-path issuance and exchange (PKCE and confidential client variants)
 *  - rejection of replayed codes (single-use guarantee)
 *  - rejection of expired codes
 *  - rejection of mismatched redirectUri / appId / PKCE verifier
 *  - rejection of public clients that present neither secret nor PKCE
 *
 * Stores are mocked; pure logic is tested against an in-memory Map.
 */

import * as crypto from 'crypto';

// In-memory store keyed by codeHash. Mirrors the shape returned by
// Mongoose .findOne / .findOneAndUpdate just enough for the service.
interface StoredCode {
  _id: string;
  codeHash: string;
  userId: string;
  appId: string;
  redirectUri: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  scopes: string[];
  usedAt: Date | null;
  expiresAt: Date;
}

const store = new Map<string, StoredCode>();
let nextId = 1;

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  default: {
    create: jest.fn(async (data: Partial<StoredCode>) => {
      const id = `code-${nextId++}`;
      // Mongoose defaults usedAt to null on insert; reflect that in the mock.
      const record: StoredCode = {
        _id: id,
        codeHash: data.codeHash ?? '',
        userId: data.userId ?? '',
        appId: data.appId ?? '',
        redirectUri: data.redirectUri ?? '',
        codeChallenge: data.codeChallenge ?? null,
        codeChallengeMethod: data.codeChallengeMethod ?? null,
        scopes: data.scopes ?? [],
        usedAt: data.usedAt ?? null,
        expiresAt: data.expiresAt ?? new Date(Date.now() + 60_000),
      };
      store.set(record.codeHash, record);
      return record;
    }),
    findOne: jest.fn(async (query: { codeHash: string }) => {
      return store.get(query.codeHash) ?? null;
    }),
    findOneAndUpdate: jest.fn(
      async (
        filter: { _id: string; usedAt: null | Date },
        update: { $set: { usedAt: Date } }
      ) => {
        for (const record of store.values()) {
          if (record._id !== filter._id) continue;
          if (record.usedAt !== null) return null;
          record.usedAt = update.$set.usedAt;
          return record;
        }
        return null;
      }
    ),
  },
  AuthCode: {},
}));

import {
  issueAuthCode,
  exchangeAuthCode,
  base64UrlEncode,
} from '../oauthCode.service';

const APP_ID = '64f7c2a1b8e9d3f4a1c2b3d4';
const USER_ID = '74f7c2a1b8e9d3f4a1c2b3d5';
const REDIRECT_URI = 'https://app.example/callback';

function makePkcePair() {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

beforeEach(() => {
  store.clear();
  nextId = 1;
});

describe('issueAuthCode', () => {
  it('returns a 256-bit base64url code and persists only the hash', async () => {
    const { code } = await issueAuthCode({
      userId: USER_ID,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
    });

    expect(code).toEqual(expect.any(String));
    expect(code.length).toBeGreaterThanOrEqual(42);
    expect(store.size).toBe(1);
    const stored = Array.from(store.values())[0];
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.codeHash).not.toBe(code); // raw code never persisted
  });
});

describe('exchangeAuthCode (H6 — single-use, binding checks)', () => {
  it('rejects an unknown code', async () => {
    const res = await exchangeAuthCode({
      rawCode: 'nope',
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      clientSecretProvided: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_grant');
  });

  it('succeeds for a confidential-client (no PKCE) exchange', async () => {
    const { code } = await issueAuthCode({
      userId: USER_ID,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
    });

    const res = await exchangeAuthCode({
      rawCode: code,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      clientSecretProvided: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.code.userId).toBe(USER_ID);
      expect(res.code.usedAt).toBeInstanceOf(Date);
    }
  });

  it('rejects a public client (no PKCE, no client secret)', async () => {
    const { code } = await issueAuthCode({
      userId: USER_ID,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
    });

    const res = await exchangeAuthCode({
      rawCode: code,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      clientSecretProvided: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_client');
  });

  it('accepts a PKCE exchange with the correct verifier', async () => {
    const { verifier, challenge } = makePkcePair();
    const { code } = await issueAuthCode({
      userId: USER_ID,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });

    const res = await exchangeAuthCode({
      rawCode: code,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    });
    expect(res.ok).toBe(true);
  });

  it('rejects a PKCE exchange with a tampered verifier', async () => {
    const { challenge } = makePkcePair();
    const { code } = await issueAuthCode({
      userId: USER_ID,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });

    const res = await exchangeAuthCode({
      rawCode: code,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: 'attacker-controlled-verifier-with-wrong-value',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_grant');
  });

  it('rejects when the redirectUri does not match', async () => {
    const { code } = await issueAuthCode({
      userId: USER_ID,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
    });

    const res = await exchangeAuthCode({
      rawCode: code,
      appId: APP_ID,
      redirectUri: 'https://evil.example/callback',
      clientSecretProvided: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_grant');
  });

  it('accepts apex origin with or without a trailing slash', async () => {
    const { code } = await issueAuthCode({
      userId: USER_ID,
      appId: APP_ID,
      redirectUri: 'https://inbox.oxy.so/',
    });

    const res = await exchangeAuthCode({
      rawCode: code,
      appId: APP_ID,
      redirectUri: 'https://inbox.oxy.so',
      clientSecretProvided: true,
    });
    expect(res.ok).toBe(true);
  });

  it('rejects when the appId does not match', async () => {
    const { code } = await issueAuthCode({
      userId: USER_ID,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
    });

    const res = await exchangeAuthCode({
      rawCode: code,
      appId: 'different-app',
      redirectUri: REDIRECT_URI,
      clientSecretProvided: true,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects replay: second exchange of the same code fails', async () => {
    const { code } = await issueAuthCode({
      userId: USER_ID,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
    });

    const first = await exchangeAuthCode({
      rawCode: code,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      clientSecretProvided: true,
    });
    expect(first.ok).toBe(true);

    const second = await exchangeAuthCode({
      rawCode: code,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      clientSecretProvided: true,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('invalid_grant');
  });

  it('rejects an expired code', async () => {
    const { code } = await issueAuthCode({
      userId: USER_ID,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      ttlMs: 10,
    });

    // Wait past TTL.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await exchangeAuthCode({
      rawCode: code,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      clientSecretProvided: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_grant');
  });
});
