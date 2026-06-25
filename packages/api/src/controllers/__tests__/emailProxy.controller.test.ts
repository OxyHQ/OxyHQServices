import { lookup } from 'dns/promises';
import { proxyResource } from '../emailProxy.controller';

jest.mock('dns/promises', () => ({
  lookup: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

type MockResponse = {
  setHeader: jest.Mock;
  send: jest.Mock;
};

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;
const originalFetch = global.fetch;

function makeReq(url: string) {
  return { query: { url } } as any;
}

function makeRes(): MockResponse {
  return {
    setHeader: jest.fn(),
    send: jest.fn(),
  };
}

function imageResponse(body = 'x'.repeat(128), init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'image/png' },
    ...init,
  });
}

describe('email proxy SSRF protections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('rejects direct private network URLs before fetching', async () => {
    const res = makeRes();

    await expect(proxyResource(makeReq('http://127.0.0.1/internal.png'), res as any)).rejects.toThrow(
      'Private network URLs are not allowed'
    );

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects hostnames that resolve to private network addresses before fetching', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const res = makeRes();

    await expect(proxyResource(makeReq('http://metadata.example/internal.png'), res as any)).rejects.toThrow(
      'Private network URLs are not allowed'
    );

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not follow redirects to private network URLs', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/internal.png' },
      })
    );
    const res = makeRes();

    await expect(proxyResource(makeReq('http://public.example/redirect'), res as any)).rejects.toThrow(
      'Private network URLs are not allowed'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://public.example/redirect',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('revalidates safe redirect targets and proxies allowed images', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example/image.png' },
        })
      )
      .mockResolvedValueOnce(imageResponse());
    const res = makeRes();

    await proxyResource(makeReq('https://public.example/redirect'), res as any);

    expect(mockLookup).toHaveBeenCalledWith('public.example', { all: true, verbatim: false });
    expect(mockLookup).toHaveBeenCalledWith('cdn.example', { all: true, verbatim: false });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://public.example/redirect',
      expect.objectContaining({ redirect: 'manual' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://cdn.example/image.png',
      expect.objectContaining({ redirect: 'manual' })
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });
});
