import {
  buildDeviceJoinReturnUrl,
  buildDeviceJoinUrl,
  isAllowedDeviceJoinOrigin,
  isIdpHubOrigin,
  parseDeviceJoinReturnUrl,
  parseDeviceJoinFragment,
  resolveHubDeviceCredentialForJoin,
  captureDeviceJoinFragmentFromUrl,
  readPendingDeviceJoinCredential,
  stripDeviceJoinFragmentFromUrl,
  OXY_DEVICE_JOIN_PENDING_KEY,
  DEVICE_JOIN_FRAGMENT_DEVICE_ID,
  DEVICE_JOIN_FRAGMENT_DEVICE_SECRET,
} from '../deviceJoin';
import { createMemoryAuthStateStore } from '../../session/authStateStore';

describe('deviceJoin', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, value: string) => {
          storage[key] = value;
        },
        removeItem: (key: string) => {
          delete storage[key];
        },
      },
    });
  });

  afterEach(() => {
    if (Object.getOwnPropertyDescriptor(globalThis, 'localStorage')) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it('builds the join URL with return param', () => {
    const url = new URL(buildDeviceJoinUrl('https://accounts.oxy.so/'));
    expect(url.pathname).toBe('/device/join');
    expect(url.searchParams.get('return')).toBe('https://accounts.oxy.so/');
  });

  it('allows official first-party origins', () => {
    expect(isAllowedDeviceJoinOrigin('https://inbox.oxy.so')).toBe(true);
    expect(isAllowedDeviceJoinOrigin('https://mention.earth')).toBe(true);
    expect(isAllowedDeviceJoinOrigin('https://evil.example')).toBe(false);
  });

  it('parses join fragment credentials', () => {
    const parsed = parseDeviceJoinFragment('#oxy_device=d1&device_secret=s1');
    expect(parsed).toEqual({ deviceId: 'd1', deviceSecret: 's1' });
  });

  it('builds return URL with fragment credentials', () => {
    const back = buildDeviceJoinReturnUrl('https://inbox.oxy.so/app', {
      deviceId: 'd1',
      deviceSecret: 's1',
    });
    expect(back).toBe('https://inbox.oxy.so/app#oxy_device=d1&device_secret=s1');
  });

  it('validates device join return URLs', () => {
    expect(parseDeviceJoinReturnUrl('https://inbox.oxy.so/inbox')).toBe(
      'https://inbox.oxy.so/inbox',
    );
    expect(parseDeviceJoinReturnUrl('https://evil.example/')).toBeNull();
    expect(parseDeviceJoinReturnUrl('javascript:alert(1)')).toBeNull();
  });

  it('detects IdP hub origin', () => {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'https://auth.oxy.so/device/join' },
    });
    expect(isIdpHubOrigin()).toBe(true);
    delete (globalThis as { location?: Location }).location;
  });

  describe('captureDeviceJoinFragmentFromUrl', () => {
    let sessionStorageData: Record<string, string>;
    const replaceState = jest.fn();

    beforeEach(() => {
      sessionStorageData = {};
      replaceState.mockClear();
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        value: {
          getItem: (key: string) => sessionStorageData[key] ?? null,
          setItem: (key: string, value: string) => {
            sessionStorageData[key] = value;
          },
          removeItem: (key: string) => {
            delete sessionStorageData[key];
          },
        },
      });
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: {
          pathname: '/inbox',
          search: '',
          hash: '',
          href: 'https://inbox.oxy.so/inbox',
        },
      });
      Object.defineProperty(globalThis, 'history', {
        configurable: true,
        value: { replaceState },
      });
    });

    afterEach(() => {
      delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
      delete (globalThis as { location?: Location }).location;
      delete (globalThis as { history?: History }).history;
    });

    it('strips join credentials from the URL and stages them in sessionStorage', () => {
      const location = (globalThis as { location: { hash: string } }).location;
      location.hash = '#oxy_device=d1&device_secret=s1';

      const creds = captureDeviceJoinFragmentFromUrl();
      expect(creds).toEqual({ deviceId: 'd1', deviceSecret: 's1' });
      expect(replaceState).toHaveBeenCalledWith(undefined, '', '/inbox');
      expect(readPendingDeviceJoinCredential()).toEqual({ deviceId: 'd1', deviceSecret: 's1' });
    });
  });

  describe('device-join-strip.js (HTML bootstrap)', () => {
    it('uses the same sessionStorage key and fragment param names as core', () => {
      const { readFileSync } = require('node:fs');
      const { join } = require('node:path');
      const script = readFileSync(
        join(__dirname, '../../../scripts/device-join-strip.js'),
        'utf8',
      );
      expect(script).toContain(OXY_DEVICE_JOIN_PENDING_KEY);
      expect(script).toContain(DEVICE_JOIN_FRAGMENT_DEVICE_ID);
      expect(script).toContain(DEVICE_JOIN_FRAGMENT_DEVICE_SECRET);
    });
  });

  describe('resolveHubDeviceCredentialForJoin', () => {
    it('provisions when the hub store is empty', async () => {
      const store = createMemoryAuthStateStore();
      const oxy = {
        mintFromDeviceSecret: jest.fn(),
        provisionDevice: jest.fn(async () => ({ deviceId: 'd-new', deviceSecret: 's-new' })),
      };
      const creds = await resolveHubDeviceCredentialForJoin(oxy, store);
      expect(creds).toEqual({ deviceId: 'd-new', deviceSecret: 's-new' });
      expect(oxy.provisionDevice).toHaveBeenCalledWith();
    });

    it('returns rotated secret after a successful mint', async () => {
      const store = createMemoryAuthStateStore();
      await store.save({
        sessionId: '',
        userId: '',
        deviceId: 'd1',
        deviceSecret: 's-old',
      });
      const oxy = {
        mintFromDeviceSecret: jest.fn(async () => ({
          accessToken: 'tok',
          expiresAt: new Date().toISOString(),
          nextDeviceSecret: 's-next',
          state: {
            deviceId: 'd1',
            activeAccountId: 'u1',
            accounts: [{ accountId: 'u1', sessionId: 'sess1' }],
          },
        })),
        provisionDevice: jest.fn(),
      };
      const creds = await resolveHubDeviceCredentialForJoin(oxy, store);
      expect(creds).toEqual({ deviceId: 'd1', deviceSecret: 's-next' });
      expect(oxy.provisionDevice).not.toHaveBeenCalled();
    });

    it('keeps the cached secret on no_active_session', async () => {
      const store = createMemoryAuthStateStore();
      await store.save({
        sessionId: '',
        userId: '',
        deviceId: 'd1',
        deviceSecret: 's-valid',
      });
      const oxy = {
        mintFromDeviceSecret: jest.fn(async () => {
          throw Object.assign(new Error('no_active_session'), { status: 401 });
        }),
        provisionDevice: jest.fn(),
      };
      const creds = await resolveHubDeviceCredentialForJoin(oxy, store);
      expect(creds).toEqual({ deviceId: 'd1', deviceSecret: 's-valid' });
    });

    it('re-issues via provision when the cached secret is stale', async () => {
      const store = createMemoryAuthStateStore();
      await store.save({
        sessionId: '',
        userId: '',
        deviceId: 'd1',
        deviceSecret: 's-stale',
      });
      const oxy = {
        mintFromDeviceSecret: jest.fn(async () => {
          throw Object.assign(new Error('invalid_device_secret'), { status: 401 });
        }),
        provisionDevice: jest.fn(async () => ({ deviceId: 'd1', deviceSecret: 's-fresh' })),
      };
      const creds = await resolveHubDeviceCredentialForJoin(oxy, store);
      expect(creds).toEqual({ deviceId: 'd1', deviceSecret: 's-fresh' });
      expect(oxy.provisionDevice).toHaveBeenCalledWith('d1');
    });
  });
});
