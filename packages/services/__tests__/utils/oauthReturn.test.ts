import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import { tryCompleteOAuthReturn, consumeHubSyncFailure } from '../../src/ui/utils/oauthReturn';
import { OXY_OAUTH_RETURN_PATH_STORAGE_KEY, persistOAuthReturnPath } from '@oxyhq/core';

describe('tryCompleteOAuthReturn', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?error=access_denied&state=abc');
  });

  test('strips OAuth error params from the URL without exchanging', async () => {
    const replaceState = jest
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => undefined);
    const commitSession = jest.fn();

    const result = await tryCompleteOAuthReturn({
      oxyServices: {} as never,
      clientId: 'oxy_dk_test',
      commitSession,
    });

    expect(result).toBe(false);
    expect(commitSession).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalled();
    const cleanedUrl = String(replaceState.mock.calls[0]?.[2] ?? '');
    expect(cleanedUrl).not.toContain('error=');
    expect(cleanedUrl).not.toContain('state=');
    replaceState.mockRestore();
  });
});

describe('consumeHubSyncFailure', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?hub_sync=failed');
  });

  test('strips hub_sync=failed from the URL and returns true', () => {
    const replaceState = jest
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => undefined);

    const result = consumeHubSyncFailure();

    expect(result).toBe(true);
    expect(replaceState).toHaveBeenCalled();
    const cleanedUrl = String(replaceState.mock.calls[0]?.[2] ?? '');
    expect(cleanedUrl).not.toContain('hub_sync=');
    replaceState.mockRestore();
  });

  test('returns false when hub_sync param is absent', () => {
    window.history.replaceState(null, '', '/');
    expect(consumeHubSyncFailure()).toBe(false);
  });
});

/**
 * The regression this guards: `redirect_uri` is a registered apex origin, so the
 * IdP always returns the tab to `/`. Before the return path was persisted, every
 * deep link — a shared URL, a search result — silently became the home page for
 * signed-out visitors on their first navigation in a tab.
 */
describe('deep-link preservation across the authorize round trip', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/?error=access_denied&state=abc');
  });

  test('returns the visitor to the page they started on, not the origin', async () => {
    // The tab was on /company/team before being bounced to the IdP.
    persistOAuthReturnPath('/company/team?tab=eng');

    const replaceState = jest
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => undefined);

    await tryCompleteOAuthReturn({
      oxyServices: {} as never,
      clientId: 'oxy_dk_test',
      commitSession: jest.fn(),
    });

    expect(String(replaceState.mock.calls[0]?.[2] ?? '')).toBe('/company/team?tab=eng');
    replaceState.mockRestore();
  });

  test('falls back to the cleaned current URL when no path was recorded', async () => {
    const replaceState = jest
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => undefined);

    await tryCompleteOAuthReturn({
      oxyServices: {} as never,
      clientId: 'oxy_dk_test',
      commitSession: jest.fn(),
    });

    const url = String(replaceState.mock.calls[0]?.[2] ?? '');
    expect(url).toBe('/');
    replaceState.mockRestore();
  });

  test('ignores a hostile stored path instead of leaving the origin', async () => {
    window.sessionStorage.setItem(OXY_OAUTH_RETURN_PATH_STORAGE_KEY, '//evil.com');

    const replaceState = jest
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => undefined);

    await tryCompleteOAuthReturn({
      oxyServices: {} as never,
      clientId: 'oxy_dk_test',
      commitSession: jest.fn(),
    });

    expect(String(replaceState.mock.calls[0]?.[2] ?? '')).toBe('/');
    replaceState.mockRestore();
  });
});
