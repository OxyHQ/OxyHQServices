import { OxyServices } from '../../OxyServices';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

describe('asset fetch credentials', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('omits credentials for arbitrary asset content URLs', async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('asset-body', { status: 200 });
    };

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    await oxy.fetchAssetContent('https://attacker.oxy.so/cdn/object.txt', 'text');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://attacker.oxy.so/cdn/object.txt');
    expect(calls[0].init?.credentials).toBe('omit');
  });

  it('includes credentials for asset content fetched from the configured API origin', async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('asset-body', { status: 200 });
    };

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    await oxy.fetchAssetContent('https://api.oxy.so/assets/private-file/stream', 'text');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.oxy.so/assets/private-file/stream');
    expect(calls[0].init?.credentials).toBe('include');
  });
});
