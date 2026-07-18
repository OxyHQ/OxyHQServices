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
        expect.objectContaining({ cache: false }),
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

      expect(result).toEqual({ ...baseInfo, originVerified: true });
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
        { cache: false },
      );

      await oxy.requestChallenge('pub-x', { retry: false });
      expect(makeRequestSpy).toHaveBeenLastCalledWith(
        'POST',
        '/auth/challenge',
        { publicKey: 'pub-x' },
        { cache: false, retry: false },
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
        { cache: false, retry: false, timeout: 9000 },
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
