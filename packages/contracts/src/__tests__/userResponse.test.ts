import {
    userResponseSchema,
    refreshAllResponseSchema,
    currentUserResponseSchema,
    deviceSessionsResponseSchema,
    resolveUserId,
    safeParseContract,
} from '../userResponse';

/**
 * The canonical contract MUST accept exactly what `formatUserResponse` emits.
 * Drift bug #1: the auth app's local schema typed `user.name` as a plain string,
 * so EVERY account that had a structured name failed `safeParse`, collapsing the
 * whole response to null and showing the user as logged-out. These tests lock the
 * structured-name shape into the single source of truth.
 */
describe('userResponseSchema', () => {
    it('accepts the structured name object emitted by formatUserResponse', () => {
        const parsed = safeParseContract(userResponseSchema, {
            id: '507f1f77bcf86cd799439011',
            username: 'nateus',
            name: { first: 'Nate', last: 'Isern', full: 'Nate Isern' },
            avatar: 'file_123',
            email: 'nate@oxy.so',
            color: 'blue',
        });
        expect(parsed).not.toBeNull();
        expect(parsed?.name?.first).toBe('Nate');
    });

    it('accepts an account with no username (publicKey-only identity)', () => {
        const parsed = safeParseContract(userResponseSchema, {
            id: '507f1f77bcf86cd799439011',
            publicKey: '0xabc',
            name: { first: 'Nate' },
        });
        expect(parsed).not.toBeNull();
        expect(parsed?.username).toBeUndefined();
    });

    it('accepts nullable avatar/color', () => {
        const parsed = safeParseContract(userResponseSchema, {
            id: 'x',
            avatar: null,
            color: null,
        });
        expect(parsed).not.toBeNull();
        expect(parsed?.avatar).toBeNull();
        expect(parsed?.color).toBeNull();
    });

    it('accepts the raw-document _id form (GET /users/me) and resolves it', () => {
        const parsed = safeParseContract(userResponseSchema, {
            _id: 'raw_id_42',
            username: 'nateus',
        });
        expect(parsed).not.toBeNull();
        expect(parsed && resolveUserId(parsed)).toBe('raw_id_42');
    });

    it('prefers id over _id in resolveUserId', () => {
        const parsed = userResponseSchema.parse({ id: 'fmt_id', _id: 'raw_id' });
        expect(resolveUserId(parsed)).toBe('fmt_id');
    });

    it('passes through unenumerated profile fields', () => {
        const parsed = userResponseSchema.parse({
            id: 'x',
            verified: true,
            language: 'en',
            bio: 'hi',
            locations: [],
            links: [],
        });
        expect(parsed.verified).toBe(true);
        expect((parsed as Record<string, unknown>).bio).toBe('hi');
    });
});

describe('refreshAllResponseSchema', () => {
    it('rejects an entry whose authuser is null', () => {
        const parsed = safeParseContract(refreshAllResponseSchema, {
            accounts: [
                {
                    authuser: null,
                    accessToken: 'tok',
                    expiresAt: '2026-01-01T00:00:00.000Z',
                    sessionId: 'sess_1',
                    user: {
                        id: 'u1',
                        username: 'nateus',
                        name: { first: 'Nate', last: 'Isern' },
                    },
                },
            ],
        });
        expect(parsed).toBeNull();
    });

    it('accepts an empty accounts array (no signed-in accounts on device)', () => {
        const parsed = safeParseContract(refreshAllResponseSchema, { accounts: [] });
        expect(parsed).not.toBeNull();
        expect(parsed?.accounts).toHaveLength(0);
    });

    it('accepts a multi-account snapshot with structured names', () => {
        const parsed = safeParseContract(refreshAllResponseSchema, {
            accounts: [
                {
                    authuser: 0,
                    accessToken: 'a',
                    expiresAt: 't',
                    sessionId: 's0',
                    user: { id: 'u0', username: 'a', name: { first: 'First' } },
                },
                {
                    authuser: 1,
                    accessToken: 'b',
                    expiresAt: 't',
                    sessionId: 's1',
                    user: { id: 'u1', username: 'b', name: { first: 'Sec', last: 'Ond' } },
                },
            ],
        });
        expect(parsed?.accounts).toHaveLength(2);
    });

    it('rejects an entry missing the required accessToken', () => {
        const parsed = safeParseContract(refreshAllResponseSchema, {
            accounts: [{ authuser: 0, expiresAt: 't', sessionId: 's', user: { id: 'u' } }],
        });
        expect(parsed).toBeNull();
    });
});

describe('currentUserResponseSchema', () => {
    it('accepts the success envelope with virtuals present', () => {
        const parsed = safeParseContract(currentUserResponseSchema, {
            data: {
                _id: 'raw_id',
                username: 'nateus',
                displayName: 'nateus',
                name: { first: 'Nate', last: 'Isern', full: 'Nate Isern' },
            },
        });
        expect(parsed).not.toBeNull();
        expect(parsed?.data.displayName).toBe('nateus');
    });

    it('accepts the envelope when virtuals (name.full / displayName) are absent', () => {
        const parsed = safeParseContract(currentUserResponseSchema, {
            data: { _id: 'raw_id', name: { first: 'Nate' } },
        });
        expect(parsed).not.toBeNull();
        expect(parsed?.data.name?.full).toBeUndefined();
    });
});

describe('deviceSessionsResponseSchema', () => {
    it('accepts entries with a structured-name user', () => {
        const parsed = safeParseContract(deviceSessionsResponseSchema, [
            {
                sessionId: 's1',
                isCurrent: true,
                user: { id: 'u1', username: 'nateus', name: { first: 'Nate' } },
            },
        ]);
        expect(parsed).not.toBeNull();
        expect(parsed?.[0].user?.name?.first).toBe('Nate');
    });

    it('accepts a null user slot', () => {
        const parsed = safeParseContract(deviceSessionsResponseSchema, [
            { sessionId: 's1', user: null },
        ]);
        expect(parsed).not.toBeNull();
        expect(parsed?.[0].user).toBeNull();
    });
});
