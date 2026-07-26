import { syncHubAfterSignIn } from '../hubSync';

jest.mock('../../utils/officialOrigins', () => {
  const actual = jest.requireActual('../../utils/officialOrigins');
  return {
    ...actual,
    isIdpHubOrigin: jest.fn(() => false),
    isOfficialWebOrigin: jest.fn(() => true),
    buildIdpHubOrigin: jest.fn(() => 'https://auth.oxy.so'),
  };
});

describe('syncHubAfterSignIn', () => {
  const originalLocation = globalThis.location;
  const originalAssign = (globalThis as { location?: Location }).location?.assign;

  afterEach(() => {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: originalLocation,
    });
    jest.restoreAllMocks();
  });

  it('includes the hash fragment in the hub-sync return URL', async () => {
    const assign = jest.fn();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: {
        origin: 'https://oxy.so',
        pathname: '/pricing',
        search: '?plan=pro',
        hash: '#compare',
        assign,
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: globalThis.location },
    });

    const issueHubTicket = jest.fn().mockResolvedValue({ ticket: 'tk-1' });

    const redirected = await syncHubAfterSignIn({ issueHubTicket });

    expect(redirected).toBe(true);
    expect(issueHubTicket).toHaveBeenCalledWith('https://auth.oxy.so');
    const syncUrl = new URL(String(assign.mock.calls[0]?.[0] ?? ''));
    expect(syncUrl.searchParams.get('return')).toBe('https://oxy.so/pricing?plan=pro#compare');
  });
});
