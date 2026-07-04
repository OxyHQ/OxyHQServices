import {
    deviceBootReasonSchema,
    deviceBootFragmentSchema,
    deviceExchangeRequestSchema,
    authTokenBundleSchema,
    webSessionResultSchema,
    tokenRefreshRequestSchema,
    tokenRefreshResponseSchema,
    deviceTokenIssueResponseSchema,
    loginResultSchema,
    deviceResolveRequestSchema,
    deviceResolveResponseSchema,
    safeParseContract,
} from '../index';
import type {
    AuthTokenBundle,
    DeviceResolveResponse,
    LoginResult,
    WebSessionResult,
} from '../index';

/**
 * The device-first bootstrap contracts MUST round-trip exactly what the new
 * `/auth/device/*` + `/auth/refresh-token` + `/auth/login` surface emits and
 * what `@oxyhq/core`'s device-boot mixin / cold boot parse. These tests lock the
 * fragment shape, the login-result union discrimination, and the token
 * bundle/refresh/resolve shapes so producer and consumers cannot drift.
 */

const A_TOKEN = 'x'.repeat(24); // >= 20 chars, satisfies the min() guards

describe('deviceBootReasonSchema', () => {
    it('accepts each known reason', () => {
        expect(safeParseContract(deviceBootReasonSchema, 'session')).toBe('session');
        expect(safeParseContract(deviceBootReasonSchema, 'no_session')).toBe('no_session');
        expect(safeParseContract(deviceBootReasonSchema, 'new_device')).toBe('new_device');
    });

    it('rejects an unknown reason', () => {
        expect(safeParseContract(deviceBootReasonSchema, 'signed_out')).toBeNull();
    });
});

describe('deviceBootFragmentSchema', () => {
    const fragment = {
        v: 1 as const,
        state: 'st_abc123',
        reason: 'session' as const,
        code: 'c'.repeat(32),
        deviceToken: A_TOKEN,
    };

    it('parses a valid session fragment (with code)', () => {
        expect(safeParseContract(deviceBootFragmentSchema, fragment)).toEqual(fragment);
    });

    it('parses a no_session fragment without a code', () => {
        const { code, ...noCode } = fragment;
        const parsed = safeParseContract(deviceBootFragmentSchema, {
            ...noCode,
            reason: 'no_session',
        });
        expect(parsed?.code).toBeUndefined();
        expect(parsed?.reason).toBe('no_session');
    });

    it('rejects v !== 1', () => {
        expect(safeParseContract(deviceBootFragmentSchema, { ...fragment, v: 2 })).toBeNull();
    });

    it('rejects an empty state', () => {
        expect(safeParseContract(deviceBootFragmentSchema, { ...fragment, state: '' })).toBeNull();
    });

    it('rejects a too-short deviceToken', () => {
        expect(
            safeParseContract(deviceBootFragmentSchema, { ...fragment, deviceToken: 'short' }),
        ).toBeNull();
    });

    it('rejects a too-short code', () => {
        expect(
            safeParseContract(deviceBootFragmentSchema, { ...fragment, code: 'short' }),
        ).toBeNull();
    });

    it('rejects an unknown reason', () => {
        expect(
            safeParseContract(deviceBootFragmentSchema, { ...fragment, reason: 'whoops' }),
        ).toBeNull();
    });
});

describe('deviceExchangeRequestSchema', () => {
    it('parses a valid code', () => {
        const v = { code: 'c'.repeat(40) };
        expect(safeParseContract(deviceExchangeRequestSchema, v)).toEqual(v);
    });

    it('rejects a too-short code', () => {
        expect(safeParseContract(deviceExchangeRequestSchema, { code: 'nope' })).toBeNull();
    });
});

describe('authTokenBundleSchema', () => {
    const bundle: AuthTokenBundle = {
        sessionId: 's1',
        accessToken: 'jwt.access',
        refreshToken: 'rt_family_head',
        expiresAt: '2026-07-07T00:00:00.000Z',
        user: { id: 'u1', username: 'nate', name: { displayName: 'Nate' } },
    };

    it('parses a valid bundle', () => {
        const parsed = safeParseContract(authTokenBundleSchema, bundle);
        expect(parsed?.sessionId).toBe('s1');
        expect(parsed?.user.username).toBe('nate');
    });

    it('rejects a bundle missing the refreshToken', () => {
        const { refreshToken, ...noRefresh } = bundle;
        expect(safeParseContract(authTokenBundleSchema, noRefresh)).toBeNull();
    });
});

describe('webSessionResultSchema (reason-discriminated union)', () => {
    const bundle: AuthTokenBundle = {
        sessionId: 's1',
        accessToken: 'jwt.access',
        refreshToken: 'rt_family_head',
        expiresAt: '2026-07-07T00:00:00.000Z',
        user: { id: 'u1', username: 'nate', name: { displayName: 'Nate' } },
    };

    it('parses the session arm (bundle nested under `session` + deviceToken)', () => {
        const sessionArm: WebSessionResult = { reason: 'session', session: bundle, deviceToken: A_TOKEN };
        const parsed = safeParseContract(webSessionResultSchema, sessionArm);
        expect(parsed).not.toBeNull();
        expect(parsed && parsed.reason === 'session' && parsed.session.sessionId).toBe('s1');
        expect(parsed?.deviceToken).toBe(A_TOKEN);
    });

    it('parses the no_session arm (deviceToken only)', () => {
        const parsed = safeParseContract(webSessionResultSchema, { reason: 'no_session', deviceToken: A_TOKEN });
        expect(parsed).not.toBeNull();
        expect(parsed?.reason).toBe('no_session');
        expect(parsed && !('session' in parsed)).toBe(true);
    });

    it('parses the new_device arm', () => {
        const parsed = safeParseContract(webSessionResultSchema, { reason: 'new_device', deviceToken: A_TOKEN });
        expect(parsed?.reason).toBe('new_device');
    });

    it('REJECTS the old bare-bundle shape (no reason wrapper)', () => {
        expect(safeParseContract(webSessionResultSchema, bundle)).toBeNull();
    });

    it('rejects a session arm missing the nested session bundle', () => {
        expect(
            safeParseContract(webSessionResultSchema, { reason: 'session', deviceToken: A_TOKEN }),
        ).toBeNull();
    });

    it('rejects any arm missing the deviceToken', () => {
        expect(safeParseContract(webSessionResultSchema, { reason: 'session', session: bundle })).toBeNull();
        expect(safeParseContract(webSessionResultSchema, { reason: 'no_session' })).toBeNull();
    });

    it('rejects an unknown reason', () => {
        expect(safeParseContract(webSessionResultSchema, { reason: 'signed_out', deviceToken: A_TOKEN })).toBeNull();
    });
});

describe('tokenRefreshRequestSchema / tokenRefreshResponseSchema', () => {
    it('parses a valid refresh request', () => {
        const v = { refreshToken: A_TOKEN };
        expect(safeParseContract(tokenRefreshRequestSchema, v)).toEqual(v);
    });

    it('rejects a too-short refresh token', () => {
        expect(safeParseContract(tokenRefreshRequestSchema, { refreshToken: 'tiny' })).toBeNull();
    });

    it('parses a valid refresh response', () => {
        const v = {
            accessToken: 'jwt.access',
            refreshToken: 'rt_next',
            expiresAt: '2026-07-07T00:15:00.000Z',
            sessionId: 's1',
        };
        expect(safeParseContract(tokenRefreshResponseSchema, v)).toEqual(v);
    });

    it('rejects a refresh response missing sessionId', () => {
        const v = { accessToken: 'a', refreshToken: 'r', expiresAt: 'e' };
        expect(safeParseContract(tokenRefreshResponseSchema, v)).toBeNull();
    });
});

describe('deviceTokenIssueResponseSchema', () => {
    it('parses a device token', () => {
        expect(safeParseContract(deviceTokenIssueResponseSchema, { deviceToken: 'dt' })).toEqual({
            deviceToken: 'dt',
        });
    });

    it('rejects a non-string device token', () => {
        expect(safeParseContract(deviceTokenIssueResponseSchema, { deviceToken: 42 })).toBeNull();
    });
});

describe('loginResultSchema (union discrimination)', () => {
    it('parses the 2FA arm', () => {
        const twoFactor: LoginResult = { twoFactorRequired: true, loginToken: 'lt_abc' };
        const parsed = safeParseContract(loginResultSchema, twoFactor);
        expect(parsed).not.toBeNull();
        // Discriminate on twoFactorRequired.
        expect(parsed && 'twoFactorRequired' in parsed && parsed.twoFactorRequired).toBe(true);
    });

    it('parses the session arm (with optional refreshToken)', () => {
        const session: LoginResult = {
            sessionId: 's1',
            deviceId: 'd1',
            expiresAt: '2026-07-07T00:00:00.000Z',
            accessToken: 'jwt.access',
            refreshToken: 'rt_head',
            user: { id: 'u1', username: 'nate' },
        };
        const parsed = safeParseContract(loginResultSchema, session);
        expect(parsed).not.toBeNull();
        // Discriminate: the session arm carries a sessionId, not twoFactorRequired.
        expect(parsed && 'sessionId' in parsed && parsed.sessionId).toBe('s1');
    });

    it('parses the session arm without accessToken/refreshToken (both optional)', () => {
        const session = {
            sessionId: 's1',
            deviceId: 'd1',
            expiresAt: '2026-07-07T00:00:00.000Z',
            user: { id: 'u1' },
        };
        expect(safeParseContract(loginResultSchema, session)).not.toBeNull();
    });

    it('rejects a 2FA arm with twoFactorRequired: false', () => {
        expect(
            safeParseContract(loginResultSchema, { twoFactorRequired: false, loginToken: 'x' }),
        ).toBeNull();
    });

    it('rejects a shape that is neither arm', () => {
        expect(safeParseContract(loginResultSchema, { hello: 'world' })).toBeNull();
    });

    it('rejects a session arm missing the user', () => {
        expect(
            safeParseContract(loginResultSchema, {
                sessionId: 's1',
                deviceId: 'd1',
                expiresAt: 'e',
            }),
        ).toBeNull();
    });
});

describe('deviceResolveRequestSchema', () => {
    it('parses a valid device key', () => {
        const v = { deviceKey: A_TOKEN };
        expect(safeParseContract(deviceResolveRequestSchema, v)).toEqual(v);
    });

    it('rejects a too-short device key', () => {
        expect(safeParseContract(deviceResolveRequestSchema, { deviceKey: 'k' })).toBeNull();
    });
});

describe('deviceResolveResponseSchema', () => {
    const response: DeviceResolveResponse = {
        activeAccountId: 'u1',
        accounts: [
            {
                user: { id: 'u1', username: 'nate', name: { displayName: 'Nate' } },
                sessionId: 's1',
                accessToken: 'jwt.access',
                expiresAt: '2026-07-07T00:00:00.000Z',
            },
        ],
    };

    it('parses a populated device set', () => {
        const parsed = safeParseContract(deviceResolveResponseSchema, response);
        expect(parsed?.accounts).toHaveLength(1);
        expect(parsed?.activeAccountId).toBe('u1');
    });

    it('accepts activeAccountId=null (signed out of all)', () => {
        const parsed = safeParseContract(deviceResolveResponseSchema, {
            activeAccountId: null,
            accounts: [],
        });
        expect(parsed?.activeAccountId).toBeNull();
        expect(parsed?.accounts).toEqual([]);
    });

    it('rejects an account missing its accessToken', () => {
        const bad = {
            activeAccountId: 'u1',
            accounts: [{ user: { id: 'u1' }, sessionId: 's1', expiresAt: 'e' }],
        };
        expect(safeParseContract(deviceResolveResponseSchema, bad)).toBeNull();
    });
});
