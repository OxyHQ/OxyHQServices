import type { OxyServices } from '@oxyhq/core';

// Spy on the platform redirect so no real navigation happens and we can assert
// the authorize URL the silent-restore flow hands to the browser.
jest.mock('../../components/oauthNavigation', () => ({
  redirectToAuthorize: jest.fn(),
}));

// jsdom's `location` is non-configurable, so the origin the code reads cannot be
// reassigned per-test. Instead, drive the ORIGIN-CLASSIFICATION predicates
// (whose real behaviour is covered by core's officialOrigins.test.ts) and keep
// every other core helper real (PKCE, authorize-URL builder, handshake store).
jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return {
    __esModule: true,
    ...actual,
    isLoopbackOrigin: jest.fn(),
    isOfficialWebOrigin: jest.fn(),
    isIdpHubOrigin: jest.fn(),
  };
});

import {
  isLoopbackOrigin,
  isOfficialWebOrigin,
  isIdpHubOrigin,
} from '@oxyhq/core';
import { redirectToAuthorize } from '../../components/oauthNavigation';
import {
  isSilentRestoreEligibleOrigin,
  maybeStartSilentOAuthRestore,
  clearCrossOriginRestoreGuards,
} from '../crossOriginRestore';

const mockRedirect = redirectToAuthorize as jest.Mock;
const mockIsLoopback = isLoopbackOrigin as jest.Mock;
const mockIsOfficial = isOfficialWebOrigin as jest.Mock;
const mockIsIdpHub = isIdpHubOrigin as jest.Mock;

const OXY_SERVICES_STUB = {} as OxyServices;

/** Default to an eligible official origin; individual tests narrow this. */
function makeOriginEligible(): void {
  mockIsLoopback.mockReturnValue(false);
  mockIsIdpHub.mockReturnValue(false);
  mockIsOfficial.mockReturnValue(true);
}

describe('crossOriginRestore', () => {
  beforeEach(() => {
    mockRedirect.mockClear();
    mockIsLoopback.mockReset();
    mockIsOfficial.mockReset();
    mockIsIdpHub.mockReset();
    globalThis.sessionStorage?.clear();
    clearCrossOriginRestoreGuards();
  });

  describe('isSilentRestoreEligibleOrigin', () => {
    it('rejects loopback / local-dev origins', () => {
      mockIsLoopback.mockReturnValue(true);
      mockIsIdpHub.mockReturnValue(false);
      mockIsOfficial.mockReturnValue(true);
      expect(isSilentRestoreEligibleOrigin('http://localhost:3000')).toBe(false);
    });

    it('rejects the central IdP hub origin (no self-hop)', () => {
      mockIsLoopback.mockReturnValue(false);
      mockIsIdpHub.mockReturnValue(true);
      mockIsOfficial.mockReturnValue(true);
      expect(isSilentRestoreEligibleOrigin('https://auth.oxy.so')).toBe(false);
    });

    it('rejects non-official origins', () => {
      mockIsLoopback.mockReturnValue(false);
      mockIsIdpHub.mockReturnValue(false);
      mockIsOfficial.mockReturnValue(false);
      expect(isSilentRestoreEligibleOrigin('https://evil.example')).toBe(false);
    });

    it('accepts official, non-loopback, non-IdP origins', () => {
      makeOriginEligible();
      expect(isSilentRestoreEligibleOrigin('https://accounts.oxy.so')).toBe(true);
    });
  });

  describe('maybeStartSilentOAuthRestore', () => {
    it('is SKIPPED on a loopback origin (no redirect)', async () => {
      mockIsLoopback.mockReturnValue(true);
      mockIsIdpHub.mockReturnValue(false);
      mockIsOfficial.mockReturnValue(true);
      const redirected = await maybeStartSilentOAuthRestore({
        oxyServices: OXY_SERVICES_STUB,
        clientId: 'oxy_dk_test',
      });
      expect(redirected).toBe(false);
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('is SKIPPED on a non-official origin (no redirect)', async () => {
      mockIsLoopback.mockReturnValue(false);
      mockIsIdpHub.mockReturnValue(false);
      mockIsOfficial.mockReturnValue(false);
      const redirected = await maybeStartSilentOAuthRestore({
        oxyServices: OXY_SERVICES_STUB,
        clientId: 'oxy_dk_test',
      });
      expect(redirected).toBe(false);
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('redirects to the PROD IdP by default on an eligible origin', async () => {
      makeOriginEligible();
      const redirected = await maybeStartSilentOAuthRestore({
        oxyServices: OXY_SERVICES_STUB,
        clientId: 'oxy_dk_test',
      });
      expect(redirected).toBe(true);
      expect(mockRedirect).toHaveBeenCalledTimes(1);
      const url = mockRedirect.mock.calls[0][0] as string;
      expect(url.startsWith('https://auth.oxy.so/authorize?')).toBe(true);
      const params = new URL(url).searchParams;
      expect(params.get('client_id')).toBe('oxy_dk_test');
      expect(params.get('prompt')).toBe('none');
    });

    it('honors an authorizeBaseUrl override (self-hosted / staging IdP)', async () => {
      makeOriginEligible();
      const redirected = await maybeStartSilentOAuthRestore({
        oxyServices: OXY_SERVICES_STUB,
        clientId: 'oxy_dk_test',
        authorizeBaseUrl: 'https://auth.staging.oxy.so/authorize',
      });
      expect(redirected).toBe(true);
      const url = mockRedirect.mock.calls[0][0] as string;
      expect(url.startsWith('https://auth.staging.oxy.so/authorize?')).toBe(true);
      const params = new URL(url).searchParams;
      expect(params.get('client_id')).toBe('oxy_dk_test');
      expect(params.get('prompt')).toBe('none');
    });
  });
});
