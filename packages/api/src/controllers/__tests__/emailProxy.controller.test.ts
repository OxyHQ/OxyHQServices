import { proxyResource } from '../emailProxy.controller';
import { BadRequestError } from '../../utils/error';

jest.mock('../../utils/logger', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

function createMockResponse() {
  const res: any = {};
  res.setHeader = jest.fn();
  res.send = jest.fn();
  return res;
}

function createRequest(url: string) {
  return {
    query: {
      url: encodeURIComponent(url),
    },
  } as any;
}

describe('email proxy controller', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects application/octet-stream font-extension responses without font bytes', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(Buffer.from('internal service secret'.repeat(10)), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      })
    ) as any;

    await expect(proxyResource(createRequest('https://example.com/benign.woff'), createMockResponse()))
      .rejects
      .toThrow(BadRequestError);
  });

  it('still accepts application/octet-stream font-extension responses with a valid font signature', async () => {
    const font = Buffer.alloc(128);
    font.write('wOFF', 0, 'ascii');

    global.fetch = jest.fn().mockResolvedValue(
      new Response(font, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      })
    ) as any;

    const res = createMockResponse();
    await proxyResource(createRequest('https://example.com/font.woff'), res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'font/woff');
    expect(res.send).toHaveBeenCalledWith(font);
  });
});
