import {
    loginResultSchema,
    deviceResolveRequestSchema,
    deviceResolveResponseSchema,
    safeParseContract,
} from '../index';
import type {
    DeviceResolveResponse,
    LoginResult,
} from '../index';

/**
 * The first-party login result + IdP device-resolve contracts MUST round-trip
 * exactly what the `/auth/login` surface emits and what `@oxyhq/core`'s auth
 * mixin / the IdP chooser parse. These tests lock the login-result union
 * discrimination (2FA arm vs session arm) and the device-resolve shape so
 * producer and consumers cannot drift. The device transport itself is the
 * zero-cookie `deviceId` + `deviceSecret` mint (see `deviceSession.test.ts`).
 */

const A_TOKEN = 'x'.repeat(24); // >= 20 chars, satisfies the min() guards

describe('loginResultSchema (union discrimination)', () => {
    it('parses the 2FA arm', () => {
        const twoFactor: LoginResult = { twoFactorRequired: true, loginToken: 'lt_abc' };
        const parsed = safeParseContract(loginResultSchema, twoFactor);
        expect(parsed).not.toBeNull();
        // Discriminate on twoFactorRequired.
        expect(parsed && 'twoFactorRequired' in parsed && parsed.twoFactorRequired).toBe(true);
    });

    it('parses the session arm', () => {
        const session: LoginResult = {
            sessionId: 's1',
            deviceId: 'd1',
            expiresAt: '2026-07-07T00:00:00.000Z',
            accessToken: 'jwt.access',
            user: { id: 'u1', username: 'nate' },
        };
        const parsed = safeParseContract(loginResultSchema, session);
        expect(parsed).not.toBeNull();
        // Discriminate: the session arm carries a sessionId, not twoFactorRequired.
        expect(parsed && 'sessionId' in parsed && parsed.sessionId).toBe('s1');
    });

    it('parses the session arm without accessToken (optional)', () => {
        const session = {
            sessionId: 's1',
            deviceId: 'd1',
            expiresAt: '2026-07-07T00:00:00.000Z',
            user: { id: 'u1' },
        };
        expect(safeParseContract(loginResultSchema, session)).not.toBeNull();
    });

    it('parses the session arm carrying the deviceSecret (zero-cookie mint credential)', () => {
        const session: LoginResult = {
            sessionId: 's1',
            deviceId: 'd1',
            expiresAt: '2026-07-07T00:00:00.000Z',
            accessToken: 'jwt.access',
            deviceSecret: 'ds_first_secret',
            user: { id: 'u1', username: 'nate' },
        };
        const parsed = safeParseContract(loginResultSchema, session);
        expect(parsed && 'deviceSecret' in parsed && parsed.deviceSecret).toBe('ds_first_secret');
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
