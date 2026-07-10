import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import { tryCompleteOAuthReturn } from '../../src/ui/utils/oauthReturn';

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
