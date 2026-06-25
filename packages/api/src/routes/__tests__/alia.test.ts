import express from 'express';
import http, { IncomingMessage } from 'http';
import { AddressInfo } from 'net';
import axios from 'axios';

jest.mock('axios');

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

interface RawResponse {
  status: number;
  body: string;
}

const request = async (app: express.Express, body: unknown): Promise<RawResponse> => {
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));

  const { port } = server.address() as AddressInfo;

  try {
    return await new Promise<RawResponse>((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/alia/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );

      req.on('error', reject);
      req.end(payload);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};

describe('Alia proxy route', () => {
  const originalAliaApiKey = process.env.ALIA_API_KEY;

  beforeEach(() => {
    mockedAxios.post.mockReset();
    process.env.ALIA_API_KEY = 'test-alia-key';
  });

  afterAll(() => {
    if (originalAliaApiKey === undefined) {
      delete process.env.ALIA_API_KEY;
    } else {
      process.env.ALIA_API_KEY = originalAliaApiKey;
    }
  });

  it('returns a safe JSON error when an upstream streaming request fails with a stream body', async () => {
    const streamBody = new IncomingMessage(null as never);

    mockedAxios.post.mockRejectedValueOnce({
      response: {
        status: 400,
        data: streamBody,
      },
    });

    const { default: aliaRouter } = await import('../alia');
    const app = express();
    app.use(express.json());
    app.use('/api/alia', aliaRouter);

    const response = await request(app, { stream: true, model: 'invalid' });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.alia.onl/v1/chat/completions',
      { stream: true, model: 'invalid' },
      expect.objectContaining({ responseType: 'stream' }),
    );
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'ALIA_PROXY_ERROR',
      message: 'Failed to reach Alia API',
    });
  });
});
