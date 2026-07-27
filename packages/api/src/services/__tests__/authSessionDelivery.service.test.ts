/**
 * Automatic Commons delivery + delivery-progress bookkeeping.
 *
 * What must hold, whatever else changes:
 *
 *  - Delivery targets ONLY the identity handed to the service (the bearer's own
 *    user id) and ONLY installs registered by an `Application` carrying the
 *    staff-controlled `identity:approval` capability. No capability ⇒ zero
 *    targets and NO send — a normal outcome, not an error.
 *  - The push payload is exactly `{ type, approvalUrl }` — no application
 *    metadata, no origin, no scopes, and never the secret `sessionToken`.
 *  - A push transport failure degrades to a well-formed "nothing delivered"
 *    result and never throws into the auth flow.
 *  - Progress is written as TIMESTAMPS through conditional updates: `pushSentAt`
 *    and `openedAt` never move `status`, and `openedAt` is written at most once,
 *    only while the request is pending and unexpired.
 */

const mockAuthSessionFindOne = jest.fn();
const mockAuthSessionUpdateOne = jest.fn();
const mockApplicationFind = jest.fn();
const mockPushTokenFind = jest.fn();
const mockSendPushToTokens = jest.fn();

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  AuthSession: { findOne: mockAuthSessionFindOne, updateOne: mockAuthSessionUpdateOne },
  default: { findOne: mockAuthSessionFindOne, updateOne: mockAuthSessionUpdateOne },
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { find: mockApplicationFind },
  default: { find: mockApplicationFind },
}));

jest.mock('../../models/PushToken', () => ({
  __esModule: true,
  PushToken: { find: mockPushTokenFind },
  default: { find: mockPushTokenFind },
}));

jest.mock('../../services/push.service', () => ({
  __esModule: true,
  pushService: { sendPushToTokens: mockSendPushToTokens, sendPushNotification: jest.fn() },
  default: { sendPushToTokens: mockSendPushToTokens, sendPushNotification: jest.fn() },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import {
  deliverAuthRequestToIdentityApps,
  markAuthRequestOpened,
  buildApprovalUrl,
  IDENTITY_APPROVAL_PUSH_TYPE,
  IDENTITY_APPROVAL_PUSH_CHANNEL,
} from '../authSessionDelivery.service';
import { IDENTITY_APPROVAL_CAPABILITY } from '../../utils/applicationCapabilities';

const IN_AN_HOUR = () => new Date(Date.now() + 3_600_000);
const AN_HOUR_AGO = () => new Date(Date.now() - 3_600_000);

/** `.select(...).lean()` chain used by both model lookups. */
function chain<T>(rows: T[]) {
  return { select: () => ({ lean: () => Promise.resolve(rows) }) };
}

function pendingSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionToken: 'secret-session-token',
    authorizeCode: 'code-1',
    status: 'pending',
    expiresAt: IN_AN_HOUR(),
    ...overrides,
  };
}

/** Every key path in a nested object — used to prove the payload leaks nothing. */
function collectKeyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...collectKeyPaths(child, path)];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthSessionUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockSendPushToTokens.mockResolvedValue({ targeted: 1, accepted: 1 });
});

describe('deliverAuthRequestToIdentityApps — targeting', () => {
  it('targets only the given identity and only capability-carrying applications', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([{ token: 'tok-vault' }]));

    const outcome = await deliverAuthRequestToIdentityApps({
      authorizeCode: 'code-1',
      identityUserId: 'user-1',
    });

    expect(mockApplicationFind).toHaveBeenCalledWith({
      status: 'active',
      capabilities: IDENTITY_APPROVAL_CAPABILITY,
    });
    expect(mockPushTokenFind).toHaveBeenCalledWith({
      userId: 'user-1',
      applicationId: { $in: ['app-commons'] },
    });

    expect(outcome).toEqual({
      ok: true,
      sessionToken: 'secret-session-token',
      delivered: true,
      targets: 1,
    });
  });

  it('yields zero targets and sends nothing when no application carries the capability', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([]));

    const outcome = await deliverAuthRequestToIdentityApps({
      authorizeCode: 'code-1',
      identityUserId: 'user-1',
    });

    expect(mockPushTokenFind).not.toHaveBeenCalled();
    expect(mockSendPushToTokens).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: true,
      sessionToken: 'secret-session-token',
      delivered: false,
      targets: 0,
    });
  });

  it('yields zero targets and sends nothing when the identity has no capable install', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([]));

    const outcome = await deliverAuthRequestToIdentityApps({
      authorizeCode: 'code-1',
      identityUserId: 'user-1',
    });

    expect(mockSendPushToTokens).not.toHaveBeenCalled();
    expect(mockAuthSessionUpdateOne).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: true, delivered: false, targets: 0 });
  });
});

describe('deliverAuthRequestToIdentityApps — payload', () => {
  it('sends exactly { type, approvalUrl } and nothing else', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([{ token: 'tok-vault' }]));

    await deliverAuthRequestToIdentityApps({ authorizeCode: 'code-1', identityUserId: 'user-1' });

    const call = mockSendPushToTokens.mock.calls[0][0] as {
      userId: string;
      tokens: string[];
      title: string;
      body: string;
      channelId: string;
      data: Record<string, unknown>;
    };

    // Recursive key set of the payload — nothing beyond the two allowed fields.
    expect(collectKeyPaths(call.data).sort()).toEqual(['approvalUrl', 'type']);
    expect(call.data).toEqual({
      type: IDENTITY_APPROVAL_PUSH_TYPE,
      approvalUrl: 'oxycommons://approve?v=1&code=code-1',
    });
    expect(IDENTITY_APPROVAL_PUSH_TYPE).toBe('oxy_commons_auth_request');

    // The secret sessionToken never leaves the server on this path.
    expect(JSON.stringify(call)).not.toContain('secret-session-token');

    // The message itself carries no request-derived display data and no action
    // category (approval can never happen from the notification shade).
    expect(Object.keys(call).sort()).toEqual([
      'body', 'channelId', 'data', 'title', 'tokens', 'userId',
    ]);
    expect(call.channelId).toBe(IDENTITY_APPROVAL_PUSH_CHANNEL);
    expect(call.userId).toBe('user-1');
    expect(call.tokens).toEqual(['tok-vault']);
  });

  it('percent-encodes the approval handle in the deep link', () => {
    expect(buildApprovalUrl('a b&c')).toBe('oxycommons://approve?v=1&code=a%20b%26c');
  });
});

describe('deliverAuthRequestToIdentityApps — failure never breaks the auth flow', () => {
  it('returns a well-formed result when the push service throws', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([{ token: 'tok-vault' }]));
    mockSendPushToTokens.mockRejectedValue(new Error('expo unreachable'));

    const outcome = await deliverAuthRequestToIdentityApps({
      authorizeCode: 'code-1',
      identityUserId: 'user-1',
    });

    expect(outcome).toEqual({
      ok: true,
      sessionToken: 'secret-session-token',
      delivered: false,
      targets: 1,
    });
    // Nothing was delivered, so no progress is recorded.
    expect(mockAuthSessionUpdateOne).not.toHaveBeenCalled();
  });

  it('reports delivered:false when no install accepted the message', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([{ token: 'tok-vault' }]));
    mockSendPushToTokens.mockResolvedValue({ targeted: 1, accepted: 0 });

    const outcome = await deliverAuthRequestToIdentityApps({
      authorizeCode: 'code-1',
      identityUserId: 'user-1',
    });

    expect(outcome).toMatchObject({ delivered: false, targets: 1 });
    expect(mockAuthSessionUpdateOne).not.toHaveBeenCalled();
  });
});

describe('deliverAuthRequestToIdentityApps — request preconditions', () => {
  it('404s an unknown authorizeCode without touching the push path', async () => {
    mockAuthSessionFindOne.mockResolvedValue(null);

    const outcome = await deliverAuthRequestToIdentityApps({
      authorizeCode: 'nope',
      identityUserId: 'user-1',
    });

    expect(outcome).toEqual({ ok: false, status: 404, message: 'Auth session not found' });
    expect(mockApplicationFind).not.toHaveBeenCalled();
    expect(mockSendPushToTokens).not.toHaveBeenCalled();
  });

  it('400s and lazily expires a request whose TTL elapsed', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession({ expiresAt: AN_HOUR_AGO() }));

    const outcome = await deliverAuthRequestToIdentityApps({
      authorizeCode: 'code-1',
      identityUserId: 'user-1',
    });

    expect(outcome).toEqual({ ok: false, status: 400, message: 'Auth session has expired' });
    expect(mockAuthSessionUpdateOne).toHaveBeenCalledWith(
      { authorizeCode: 'code-1', status: 'pending' },
      { $set: { status: 'expired' } },
    );
    expect(mockSendPushToTokens).not.toHaveBeenCalled();
  });

  it('400s a request that is no longer pending', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession({ status: 'authorized' }));

    const outcome = await deliverAuthRequestToIdentityApps({
      authorizeCode: 'code-1',
      identityUserId: 'user-1',
    });

    expect(outcome).toEqual({ ok: false, status: 400, message: 'Auth session is no longer pending' });
    expect(mockSendPushToTokens).not.toHaveBeenCalled();
  });
});

describe('deliverAuthRequestToIdentityApps — progress is a timestamp', () => {
  it('records pushSentAt once, conditioned on the request still being pending', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([{ token: 'tok-vault' }]));

    await deliverAuthRequestToIdentityApps({ authorizeCode: 'code-1', identityUserId: 'user-1' });

    expect(mockAuthSessionUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = mockAuthSessionUpdateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(filter).toEqual({ authorizeCode: 'code-1', status: 'pending', pushSentAt: null });
    expect(Object.keys(update)).toEqual(['$set']);
    expect(Object.keys(update.$set)).toEqual(['pushSentAt']);
    expect(update.$set.pushSentAt).toBeInstanceOf(Date);
  });
});

describe('markAuthRequestOpened', () => {
  it('404s an unknown authorizeCode', async () => {
    mockAuthSessionFindOne.mockResolvedValue(null);

    const outcome = await markAuthRequestOpened('nope');

    expect(outcome).toEqual({ ok: false, status: 404, message: 'Auth session not found' });
    expect(mockAuthSessionUpdateOne).not.toHaveBeenCalled();
  });

  it('records openedAt once, pending-only, unexpired-only, and never touches status', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());

    const outcome = await markAuthRequestOpened('code-1');

    expect(outcome).toEqual({ ok: true, sessionToken: 'secret-session-token', recorded: true });

    const [filter, update] = mockAuthSessionUpdateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(Object.keys(filter).sort()).toEqual(['authorizeCode', 'expiresAt', 'openedAt', 'status']);
    expect(filter.authorizeCode).toBe('code-1');
    expect(filter.status).toBe('pending');
    expect(filter.openedAt).toBeNull();
    expect(filter.expiresAt).toEqual({ $gt: expect.any(Date) });

    expect(Object.keys(update)).toEqual(['$set']);
    expect(Object.keys(update.$set)).toEqual(['openedAt']);
    expect(update.$set.openedAt).toBeInstanceOf(Date);
  });

  it('is idempotent: a repeat call records nothing', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession({ openedAt: new Date() }));
    mockAuthSessionUpdateOne.mockResolvedValue({ modifiedCount: 0 });

    const outcome = await markAuthRequestOpened('code-1');

    expect(outcome).toEqual({ ok: true, sessionToken: 'secret-session-token', recorded: false });
  });

  it('records nothing for an already-authorized request', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession({ status: 'authorized' }));
    // The conditional update matches nothing — the DB, not a branch, enforces it.
    mockAuthSessionUpdateOne.mockResolvedValue({ modifiedCount: 0 });

    const outcome = await markAuthRequestOpened('code-1');

    expect(outcome).toMatchObject({ ok: true, recorded: false });
  });
});
