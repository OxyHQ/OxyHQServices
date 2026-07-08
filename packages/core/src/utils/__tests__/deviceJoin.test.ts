import {
  buildDeviceJoinReturnUrl,
  buildDeviceJoinUrl,
  isAllowedDeviceJoinOrigin,
  isDeviceJoinV2Complete,
  markDeviceJoinV2Complete,
  OXY_DEVICE_JOIN_V2_KEY,
  parseDeviceJoinFragment,
} from '../deviceJoin';

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

  it('tracks device join v2 completion in localStorage', () => {
    localStorage.removeItem(OXY_DEVICE_JOIN_V2_KEY);
    expect(isDeviceJoinV2Complete()).toBe(false);
    markDeviceJoinV2Complete();
    expect(isDeviceJoinV2Complete()).toBe(true);
    expect(localStorage.getItem(OXY_DEVICE_JOIN_V2_KEY)).toBe('1');
  });
});
