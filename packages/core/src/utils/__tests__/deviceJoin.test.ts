import {
  buildDeviceJoinReturnUrl,
  buildDeviceJoinUrl,
  isAllowedDeviceJoinOrigin,
  parseDeviceJoinFragment,
} from '../deviceJoin';

describe('deviceJoin', () => {
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
});
