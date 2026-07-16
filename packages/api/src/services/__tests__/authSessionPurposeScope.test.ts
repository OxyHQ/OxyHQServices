/**
 * Purpose-scoping of the signin/handoff challenge burn (b3 F3 security review).
 *
 * The symmetric invariant to the rotate flow's purpose scoping: a `rotate_key`
 * challenge must NOT be spendable by the "Sign in with Oxy" key-signed handoff
 * (`authorizeSessionWithSignedChallenge`). The signin challenge lookup is scoped
 * to `purpose ∈ {signin, null}`, so a `rotate_key` challenge is never found and
 * the flow returns 401 BEFORE it ever verifies a signature — distinct from the
 * "found but bad signature" path, which lets us prove the gate is the purpose
 * filter (not just a missing challenge).
 */

interface ChallengeEntry {
  publicKey: string;
  purpose: string | null;
  used: boolean;
  expiresAt: Date;
}

const mockChallengeStore = new Map<string, ChallengeEntry>();

jest.mock('../../models/AuthChallenge', () => ({
  __esModule: true,
  default: {
    findOne: (filter: {
      publicKey?: string;
      challenge: string;
      used?: boolean;
      purpose?: { $in: Array<string | null> };
      expiresAt?: { $gt: Date };
    }) => ({
      lean: () => {
        const entry = mockChallengeStore.get(filter.challenge);
        if (!entry) return Promise.resolve(null);
        if (filter.publicKey !== undefined && entry.publicKey !== filter.publicKey) return Promise.resolve(null);
        if (filter.used !== undefined && entry.used !== filter.used) return Promise.resolve(null);
        if (filter.purpose?.$in && !filter.purpose.$in.includes(entry.purpose)) return Promise.resolve(null);
        if (filter.expiresAt?.$gt && !(entry.expiresAt > filter.expiresAt.$gt)) return Promise.resolve(null);
        return Promise.resolve({ _id: 'challenge-id', ...entry });
      },
    }),
    findOneAndUpdate: () => Promise.resolve(null),
  },
}));

// Minimal stubs for the model/service imports that would otherwise crash under
// the global mongoose mock. None are reached in these tests — the flow returns
// at (or before) the signature check.
jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
  AuthSession: { findOne: jest.fn() },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: jest.fn() },
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findById: jest.fn() },
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: jest.fn() },
}));

import type { Request } from 'express';
import { authorizeSessionWithSignedChallenge } from '../authSession.service';

const PUBLIC_KEY = 'test-public-key';

beforeEach(() => {
  mockChallengeStore.clear();
});

describe('authorizeSessionWithSignedChallenge — challenge purpose scoping', () => {
  it('rejects a rotate_key challenge at the challenge gate (never reaches signature verification)', async () => {
    mockChallengeStore.set('chal-rotate', {
      publicKey: PUBLIC_KEY,
      purpose: 'rotate_key',
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    const outcome = await authorizeSessionWithSignedChallenge({
      authorizeCode: 'code-1',
      publicKey: PUBLIC_KEY,
      challenge: 'chal-rotate',
      signature: 'anything',
      timestamp: Date.now(),
      req: {} as Request,
    });

    // 401 with the "not found" message — the purpose filter excluded it BEFORE
    // any signature check (a bad-signature rejection would say 'Invalid signature').
    expect(outcome).toEqual({ ok: false, status: 401, message: 'Invalid or expired challenge' });
  });

  it('finds a signin-purpose challenge (fails later at signature verification)', async () => {
    mockChallengeStore.set('chal-signin', {
      publicKey: PUBLIC_KEY,
      purpose: 'signin',
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    const outcome = await authorizeSessionWithSignedChallenge({
      authorizeCode: 'code-1',
      publicKey: PUBLIC_KEY,
      challenge: 'chal-signin',
      signature: 'a-bogus-signature',
      timestamp: Date.now(),
      req: {} as Request,
    });

    // The challenge WAS found (purpose gate passed) — it only failed at the
    // signature check, proving the gate accepts signin challenges.
    expect(outcome).toEqual({ ok: false, status: 401, message: 'Invalid signature' });
  });

  it('finds a legacy challenge with no purpose field (treated as signin)', async () => {
    mockChallengeStore.set('chal-legacy', {
      publicKey: PUBLIC_KEY,
      purpose: null, // predates the `purpose` field
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    const outcome = await authorizeSessionWithSignedChallenge({
      authorizeCode: 'code-1',
      publicKey: PUBLIC_KEY,
      challenge: 'chal-legacy',
      signature: 'a-bogus-signature',
      timestamp: Date.now(),
      req: {} as Request,
    });

    expect(outcome).toEqual({ ok: false, status: 401, message: 'Invalid signature' });
  });
});
