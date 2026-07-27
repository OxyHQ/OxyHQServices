/**
 * "Sign in with Oxy" handoff tests (Workstream C).
 *
 * Stubs `makeRequest` (and the shared challenge/sign primitives) so the tests
 * run with no network. We assert the exact request bodies the RP and the
 * approver send — these are the load-bearing coordination points with the C2
 * server endpoints — plus the native-vs-web behaviour of the shared-key SSO.
 */

import type { SessionLoginResponse } from '../../models/session';
import type { ChallengeResponse } from '../OxyServices.auth';
import { OxyServices } from '../../OxyServices';
import { KeyManager } from '../../crypto/keyManager';
import { SignatureService } from '../../crypto/signatureService';

const challengeFixture: ChallengeResponse = {
  challenge: 'chal-xyz',
  expiresAt: '2026-06-26T00:05:00.000Z',
};

const sessionFixture: SessionLoginResponse = {
  sessionId: 's1',
  deviceId: 'd1',
  expiresAt: '2026-06-26T00:05:00.000Z',
  accessToken: 'at-1',
  user: { id: 'u1', username: 'nate', name: { displayName: 'Nate' } },
};

describe('OxyServices — "Sign in with Oxy" handoff', () => {
  let oxy: OxyServices;
  let makeRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    makeRequestSpy = jest.spyOn(oxy, 'makeRequest');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('startCommonsSignIn (relying party)', () => {
    it('generates a client-side sessionToken and POSTs /auth/session/create', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      jest.spyOn(SignatureService, 'generateChallenge').mockResolvedValue('secret-session-token');
      makeRequestSpy.mockResolvedValue({
        authorizeCode: 'code-1',
        qrPayload: 'oxycommons://approve?v=1&code=code-1',
        status: 'pending',
        expiresAt: 1700000300000,
      });

      const handle = await oxy.startCommonsSignIn({ clientId: 'oxy_dk_test' });

      // expiry is client-proposed (now + 5 min) on the request...
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/auth/session/create',
        { sessionToken: 'secret-session-token', expiresAt: 1700000300000, clientId: 'oxy_dk_test' },
        expect.objectContaining({ cache: false, skipAuth: true }),
      );
      // ...and the handle carries the SECRET token + the server's public code/payload.
      expect(handle).toEqual({
        sessionToken: 'secret-session-token',
        authorizeCode: 'code-1',
        qrPayload: 'oxycommons://approve?v=1&code=code-1',
        expiresAt: 1700000300000,
        status: 'pending',
      });
      // The secret token must never leak into the QR payload.
      expect(handle.qrPayload).not.toContain('secret-session-token');
    });

    it('omits the oauth key entirely when no OAuth binding is given (body byte-identical to a plain device sign-in)', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      jest.spyOn(SignatureService, 'generateChallenge').mockResolvedValue('tok');
      makeRequestSpy.mockResolvedValue({
        authorizeCode: 'code-1',
        qrPayload: 'oxycommons://approve?v=1&code=code-1',
        status: 'pending',
      });

      await oxy.startCommonsSignIn({ clientId: 'oxy_dk_test' });

      // `toHaveBeenCalledWith` ignores explicitly-undefined keys, so assert the
      // literal key set: the server decides the request's purpose from the
      // PRESENCE of `oauth`, and an `oauth: undefined` key would still serialize
      // differently from the body this endpoint has always received.
      const body = makeRequestSpy.mock.calls[0][2];
      expect(Object.keys(body)).toEqual(['sessionToken', 'expiresAt', 'clientId']);
    });

    it('sends the OAuth binding verbatim when provided', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      jest.spyOn(SignatureService, 'generateChallenge').mockResolvedValue('secret-session-token');
      makeRequestSpy.mockResolvedValue({
        authorizeCode: 'code-oauth',
        qrPayload: 'oxycommons://approve?v=1&code=code-oauth',
        status: 'pending',
      });

      const oauth = {
        redirectUri: 'https://mention.earth',
        codeChallenge: 'chal-s256',
        codeChallengeMethod: 'S256' as const,
        scope: 'openid profile',
        subjectAccountId: 'acct-org',
      };

      const handle = await oxy.startCommonsSignIn({ clientId: 'oxy_dk_test', oauth });

      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/auth/session/create',
        {
          sessionToken: 'secret-session-token',
          expiresAt: 1700000300000,
          clientId: 'oxy_dk_test',
          oauth,
        },
        expect.objectContaining({ cache: false, skipAuth: true }),
      );
      // The PKCE verifier and the secret token never leave the initiator, and
      // the QR still only carries the public code.
      expect(JSON.stringify(makeRequestSpy.mock.calls[0][2])).not.toContain('codeVerifier');
      expect(handle.qrPayload).not.toContain('secret-session-token');
    });

    it('carries an OAuth binding without a scope or delegated account unchanged', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      jest.spyOn(SignatureService, 'generateChallenge').mockResolvedValue('tok');
      makeRequestSpy.mockResolvedValue({
        authorizeCode: 'code-oauth',
        qrPayload: 'oxycommons://approve?v=1&code=code-oauth',
        status: 'pending',
      });

      await oxy.startCommonsSignIn({
        clientId: 'oxy_dk_test',
        oauth: {
          redirectUri: 'https://mention.earth',
          codeChallenge: 'chal-s256',
          codeChallengeMethod: 'S256',
        },
      });

      expect(makeRequestSpy.mock.calls[0][2].oauth).toEqual({
        redirectUri: 'https://mention.earth',
        codeChallenge: 'chal-s256',
        codeChallengeMethod: 'S256',
      });
    });

    it('falls back to the client-proposed expiry when the server omits it', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      jest.spyOn(SignatureService, 'generateChallenge').mockResolvedValue('tok');
      makeRequestSpy.mockResolvedValue({
        authorizeCode: 'code-2',
        qrPayload: 'oxycommons://approve?v=1&code=code-2',
        status: 'pending',
      });

      const handle = await oxy.startCommonsSignIn({ clientId: 'oxy_dk_test' });
      expect(handle.expiresAt).toBe(1700000000000 + 5 * 60 * 1000);
    });
  });

  describe('pollCommonsSignIn (relying party)', () => {
    it('GETs the session status without cache/retry', async () => {
      makeRequestSpy.mockResolvedValue({ authorized: true, sessionId: 's1' });

      const result = await oxy.pollCommonsSignIn('secret-session-token');

      expect(result).toEqual({ authorized: true, sessionId: 's1' });
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/auth/session/status/secret-session-token',
        undefined,
        expect.objectContaining({ cache: false, retry: false }),
      );
    });
  });

  describe('finalizeCommonsOAuth (relying party)', () => {
    it('POSTs the finalize path with the SECRET sessionToken and no bearer', async () => {
      makeRequestSpy.mockResolvedValue({
        code: 'authcode-1',
        redirectUri: 'https://mention.earth',
        expiresIn: 60,
      });

      const result = await oxy.finalizeCommonsOAuth('secret session/token');

      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        // The secret token is the credential in the path — encoded, never raw.
        '/auth/session/finalize/secret%20session%2Ftoken',
        undefined,
        expect.objectContaining({ cache: false, skipAuth: true }),
      );
      // An authorization CODE, never a token: the caller still runs the PKCE
      // exchange with the verifier it never sent.
      expect(result).toEqual({
        code: 'authcode-1',
        redirectUri: 'https://mention.earth',
        expiresIn: 60,
      });
    });

    it('does not plant any token (finalization is not a session)', async () => {
      makeRequestSpy.mockResolvedValue({
        code: 'authcode-1',
        redirectUri: 'https://mention.earth',
        expiresIn: 60,
      });

      await oxy.finalizeCommonsOAuth('secret-session-token');

      expect(oxy.getAccessToken()).toBeNull();
    });

    it.each([
      ['a non-object body', 'authcode-1'],
      ['a null body', null],
    ])('rejects %s rather than returning it', async (_label, value) => {
      makeRequestSpy.mockResolvedValue(value);

      await expect(oxy.finalizeCommonsOAuth('secret-session-token')).rejects.toThrow(
        /unexpected response shape/,
      );
    });

    it.each([
      ['a missing code', { redirectUri: 'https://mention.earth', expiresIn: 60 }],
      ['an empty code', { code: '', redirectUri: 'https://mention.earth', expiresIn: 60 }],
      ['a missing redirectUri', { code: 'authcode-1', expiresIn: 60 }],
      ['an empty redirectUri', { code: 'authcode-1', redirectUri: '', expiresIn: 60 }],
      ['a missing expiresIn', { code: 'authcode-1', redirectUri: 'https://mention.earth' }],
      [
        'a non-numeric expiresIn',
        { code: 'authcode-1', redirectUri: 'https://mention.earth', expiresIn: '60' },
      ],
      [
        'a non-finite expiresIn',
        { code: 'authcode-1', redirectUri: 'https://mention.earth', expiresIn: Number.NaN },
      ],
    ])('rejects %s rather than returning a half-parsed result', async (_label, value) => {
      makeRequestSpy.mockResolvedValue(value);

      await expect(oxy.finalizeCommonsOAuth('secret-session-token')).rejects.toThrow(
        /incomplete authorization code/,
      );
    });

    it('surfaces a server rejection through the shared error handler', async () => {
      makeRequestSpy.mockRejectedValue(new Error('Invalid or expired sign-in request'));

      await expect(oxy.finalizeCommonsOAuth('secret-session-token')).rejects.toThrow(
        'Invalid or expired sign-in request',
      );
    });
  });

  describe('getCommonsApprovalInfo (approver)', () => {
    const baseInfo = {
      application: {
        id: 'app1',
        name: 'Mention',
        type: 'first_party' as const,
        isOfficial: true,
        isInternal: false,
        scopes: ['profile'],
      },
      scopes: ['profile'],
      boundOrigin: 'https://mention.earth',
      expiresAt: 1700000300000,
      status: 'pending',
    };

    it('GETs the server-resolved approval info by authorizeCode', async () => {
      makeRequestSpy.mockResolvedValue({ ...baseInfo, originVerified: true });

      const result = await oxy.getCommonsApprovalInfo('code-1');

      expect(result).toEqual({
        ...baseInfo,
        originVerified: true,
        purpose: 'device_sign_in',
        subjectAccount: null,
      });
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/auth/session/approve-info/code-1',
        undefined,
        expect.objectContaining({ cache: false }),
      );
    });

    it('coerces a missing originVerified to false (fail-safe to "not verified")', async () => {
      makeRequestSpy.mockResolvedValue(baseInfo);

      const result = await oxy.getCommonsApprovalInfo('code-1');

      expect(result.originVerified).toBe(false);
    });

    it('parses an OAuth-bound request with its delegated subject account', async () => {
      makeRequestSpy.mockResolvedValue({
        ...baseInfo,
        originVerified: true,
        purpose: 'oauth_authorization',
        subjectAccount: { id: 'acct-org', username: 'oxy', displayName: 'The Oxy Collective' },
      });

      const result = await oxy.getCommonsApprovalInfo('code-1');

      expect(result.purpose).toBe('oauth_authorization');
      expect(result.subjectAccount).toEqual({
        id: 'acct-org',
        username: 'oxy',
        displayName: 'The Oxy Collective',
      });
    });

    it('keeps a delegated account without a displayName (omits the key rather than blanking it)', async () => {
      makeRequestSpy.mockResolvedValue({
        ...baseInfo,
        subjectAccount: { id: 'acct-org', username: 'oxy' },
      });

      const result = await oxy.getCommonsApprovalInfo('code-1');

      expect(result.subjectAccount).toEqual({ id: 'acct-org', username: 'oxy' });
    });

    it('degrades a server that omits purpose/subjectAccount to a plain device sign-in', async () => {
      makeRequestSpy.mockResolvedValue(baseInfo);

      const result = await oxy.getCommonsApprovalInfo('code-1');

      expect(result.purpose).toBe('device_sign_in');
      expect(result.subjectAccount).toBeNull();
    });

    it('coerces an unrecognized purpose to device_sign_in (never implies an OAuth grant)', async () => {
      makeRequestSpy.mockResolvedValue({ ...baseInfo, purpose: 'something_else' });

      const result = await oxy.getCommonsApprovalInfo('code-1');

      expect(result.purpose).toBe('device_sign_in');
    });

    it.each([
      ['a half-populated object', { id: 'acct-org' }],
      ['a non-string id', { id: 7, username: 'oxy' }],
      ['an empty username', { id: 'acct-org', username: '' }],
      ['a non-object', 'acct-org'],
      ['an explicit null', null],
    ])('rejects %s subjectAccount whole (fail-safe to "no delegation")', async (_label, value) => {
      makeRequestSpy.mockResolvedValue({ ...baseInfo, subjectAccount: value });

      const result = await oxy.getCommonsApprovalInfo('code-1');

      expect(result.subjectAccount).toBeNull();
    });

    it('drops a non-string displayName rather than rendering it', async () => {
      makeRequestSpy.mockResolvedValue({
        ...baseInfo,
        subjectAccount: { id: 'acct-org', username: 'oxy', displayName: 42 },
      });

      const result = await oxy.getCommonsApprovalInfo('code-1');

      expect(result.subjectAccount).toEqual({ id: 'acct-org', username: 'oxy' });
    });

    it('coerces a non-boolean originVerified to false', async () => {
      makeRequestSpy.mockResolvedValue({ ...baseInfo, originVerified: 'yes' });

      const result = await oxy.getCommonsApprovalInfo('code-1');

      expect(result.originVerified).toBe(false);
    });

    it('passes through a server originVerified:false unchanged', async () => {
      makeRequestSpy.mockResolvedValue({ ...baseInfo, originVerified: false });

      const result = await oxy.getCommonsApprovalInfo('code-1');

      expect(result.originVerified).toBe(false);
    });
  });

  describe('approveCommonsSignIn (approver)', () => {
    it('requests a challenge, signs with the PRIMARY key, and POSTs authorize-signed', async () => {
      jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue('pub-primary');
      const requestChallengeSpy = jest
        .spyOn(oxy, 'requestChallenge')
        .mockResolvedValue(challengeFixture);
      const signChallengeSpy = jest.spyOn(SignatureService, 'signChallenge').mockResolvedValue({
        challenge: 'sig-primary',
        publicKey: 'pub-primary',
        timestamp: 1700000000123,
      });
      // authorize-signed is the only network call (challenge is mocked above).
      makeRequestSpy.mockResolvedValue({ success: true });

      const result = await oxy.approveCommonsSignIn({
        authorizeCode: 'code-1',
        deviceName: 'iPhone',
      });

      expect(requestChallengeSpy).toHaveBeenCalledWith('pub-primary');
      expect(signChallengeSpy).toHaveBeenCalledWith('chal-xyz');
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/auth/session/authorize-signed/code-1',
        {
          publicKey: 'pub-primary',
          challenge: 'chal-xyz',
          signature: 'sig-primary',
          timestamp: 1700000000123,
          deviceName: 'iPhone',
        },
        expect.objectContaining({ cache: false }),
      );
      expect(result).toEqual({ success: true });
    });

    it('omits deviceName/deviceFingerprint when not provided', async () => {
      jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue('pub-primary');
      jest.spyOn(oxy, 'requestChallenge').mockResolvedValue(challengeFixture);
      jest.spyOn(SignatureService, 'signChallenge').mockResolvedValue({
        challenge: 'sig-primary',
        publicKey: 'pub-primary',
        timestamp: 1700000000123,
      });
      makeRequestSpy.mockResolvedValue({ success: true });

      await oxy.approveCommonsSignIn({ authorizeCode: 'code-1' });

      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/auth/session/authorize-signed/code-1',
        {
          publicKey: 'pub-primary',
          challenge: 'chal-xyz',
          signature: 'sig-primary',
          timestamp: 1700000000123,
        },
        expect.objectContaining({ cache: false }),
      );
    });

    it('throws (no network) when the device has no primary identity', async () => {
      jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue(null);
      await expect(oxy.approveCommonsSignIn({ authorizeCode: 'code-1' })).rejects.toThrow(
        /No identity found/,
      );
      expect(makeRequestSpy).not.toHaveBeenCalled();
    });
  });

  describe('denyCommonsSignIn (approver)', () => {
    it('POSTs /auth/session/deny/:authorizeCode', async () => {
      makeRequestSpy.mockResolvedValue({ success: true });

      const result = await oxy.denyCommonsSignIn('code-1');

      expect(result).toEqual({ success: true });
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/auth/session/deny/code-1',
        undefined,
        expect.objectContaining({ cache: false }),
      );
    });
  });

  describe('requestChallenge / verifyChallenge — requestOptions spread into makeRequest', () => {
    it('requestChallenge omits transport overrides by default (retries ON) and spreads them when given', async () => {
      makeRequestSpy.mockResolvedValue(challengeFixture);

      await oxy.requestChallenge('pub-x');
      expect(makeRequestSpy).toHaveBeenLastCalledWith(
        'POST',
        '/auth/challenge',
        { publicKey: 'pub-x' },
        { cache: false, skipAuth: true },
      );

      await oxy.requestChallenge('pub-x', { retry: false });
      expect(makeRequestSpy).toHaveBeenLastCalledWith(
        'POST',
        '/auth/challenge',
        { publicKey: 'pub-x' },
        { cache: false, skipAuth: true, retry: false },
      );
    });

    it('verifyChallenge spreads requestOptions (retry + timeout) into makeRequest', async () => {
      makeRequestSpy.mockResolvedValue(sessionFixture);

      await oxy.verifyChallenge('pub-x', 'chal', 'sig', 123, 'dev', 'fp', {
        retry: false,
        timeout: 9000,
      });

      expect(makeRequestSpy).toHaveBeenLastCalledWith(
        'POST',
        '/auth/verify',
        {
          publicKey: 'pub-x',
          challenge: 'chal',
          signature: 'sig',
          timestamp: 123,
          deviceName: 'dev',
          deviceFingerprint: 'fp',
        },
        { cache: false, skipAuth: true, retry: false, timeout: 9000 },
      );
    });
  });

  describe('signInWithSharedIdentity (Mechanism A — same-device SSO)', () => {
    it('mints a session from the shared key when one exists (native)', async () => {
      jest.spyOn(KeyManager, 'hasSharedIdentity').mockResolvedValue(true);
      jest.spyOn(KeyManager, 'getSharedPublicKey').mockResolvedValue('shared-pub');
      const requestChallengeSpy = jest
        .spyOn(oxy, 'requestChallenge')
        .mockResolvedValue({ challenge: 'chal-shared', expiresAt: '2026-06-26T00:05:00.000Z' });
      jest.spyOn(SignatureService, 'signChallengeWithSharedKey').mockResolvedValue({
        challenge: 'sig-shared',
        publicKey: 'shared-pub',
        timestamp: 1700000000456,
      });
      const verifyChallengeSpy = jest
        .spyOn(oxy, 'verifyChallenge')
        .mockResolvedValue(sessionFixture);

      const result = await oxy.signInWithSharedIdentity({
        deviceName: 'iPad',
        deviceFingerprint: 'fp-1',
      });

      // No requestOptions passed → both round-trips get `undefined` (defaults:
      // retries ON), preserving interactive behaviour.
      expect(requestChallengeSpy).toHaveBeenCalledWith('shared-pub', undefined);
      expect(verifyChallengeSpy).toHaveBeenCalledWith(
        'shared-pub',
        'chal-shared',
        'sig-shared',
        1700000000456,
        'iPad',
        'fp-1',
        undefined,
      );
      expect(result).toEqual(sessionFixture);
    });

    it('threads requestOptions into BOTH the challenge and verify round-trips (cold-boot retry:false)', async () => {
      jest.spyOn(KeyManager, 'hasSharedIdentity').mockResolvedValue(true);
      jest.spyOn(KeyManager, 'getSharedPublicKey').mockResolvedValue('shared-pub');
      const requestChallengeSpy = jest
        .spyOn(oxy, 'requestChallenge')
        .mockResolvedValue({ challenge: 'chal-shared', expiresAt: '2026-06-26T00:05:00.000Z' });
      jest.spyOn(SignatureService, 'signChallengeWithSharedKey').mockResolvedValue({
        challenge: 'sig-shared',
        publicKey: 'shared-pub',
        timestamp: 1700000000456,
      });
      const verifyChallengeSpy = jest
        .spyOn(oxy, 'verifyChallenge')
        .mockResolvedValue(sessionFixture);

      const result = await oxy.signInWithSharedIdentity({
        requestOptions: { retry: false },
      });

      // The SAME requestOptions object is forwarded to both calls — this is how
      // the cold-boot `shared-key-signin` step keeps its two round-trips as
      // single attempts without changing interactive defaults.
      expect(requestChallengeSpy).toHaveBeenCalledWith('shared-pub', { retry: false });
      expect(verifyChallengeSpy).toHaveBeenCalledWith(
        'shared-pub',
        'chal-shared',
        'sig-shared',
        1700000000456,
        undefined,
        undefined,
        { retry: false },
      );
      expect(result).toEqual(sessionFixture);
    });

    it('returns null (no network) when no shared identity exists — the web case', async () => {
      // hasSharedIdentity() is already false on web; emulate that verdict.
      jest.spyOn(KeyManager, 'hasSharedIdentity').mockResolvedValue(false);
      const requestChallengeSpy = jest.spyOn(oxy, 'requestChallenge');
      const verifyChallengeSpy = jest.spyOn(oxy, 'verifyChallenge');

      const result = await oxy.signInWithSharedIdentity();

      expect(result).toBeNull();
      expect(requestChallengeSpy).not.toHaveBeenCalled();
      expect(verifyChallengeSpy).not.toHaveBeenCalled();
    });

    it('returns null when the shared public key is unexpectedly absent', async () => {
      jest.spyOn(KeyManager, 'hasSharedIdentity').mockResolvedValue(true);
      jest.spyOn(KeyManager, 'getSharedPublicKey').mockResolvedValue(null);
      const verifyChallengeSpy = jest.spyOn(oxy, 'verifyChallenge');

      const result = await oxy.signInWithSharedIdentity();

      expect(result).toBeNull();
      expect(verifyChallengeSpy).not.toHaveBeenCalled();
    });
  });
});
