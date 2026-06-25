import express from 'express';
import http from 'http';

const mockAuthMiddleware = jest.fn();
const mockResolveNames = jest.fn();
const mockFindOneAndUpdate = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
}));

jest.mock('../../services/TopicService.js', () => ({
  topicService: {
    list: jest.fn(),
    localizeTopics: jest.fn(),
    getCategories: jest.fn(),
    search: jest.fn(),
    getBySlug: jest.fn(),
    resolveNames: (...args: unknown[]) => mockResolveNames(...args),
  },
}));

jest.mock('../../models/Topic.js', () => ({
  TopicType: {
    Category: 'category',
    Tag: 'tag',
  },
  Topic: {
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
  },
}));

import topicsRouter from '../topics.routes';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

function requestJson(
  server: http.Server,
  method: string,
  path: string,
  payload?: unknown
): Promise<JsonResponse> {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    return Promise.reject(new Error('server not listening on a TCP port'));
  }
  const { port } = address;
  const body = payload === undefined ? '' : JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw.length > 0 ? JSON.parse(raw) : {} });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let server: http.Server;
let currentIsStaff = false;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/topics', topicsRouter);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  currentIsStaff = false;
  mockAuthMiddleware.mockImplementation(
    (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = {
        _id: { toString: () => 'user-id' },
        isStaff: currentIsStaff,
      };
      next();
    }
  );
});

describe('/topics write authorization', () => {
  it('rejects topic resolution for authenticated non-staff users', async () => {
    const res = await requestJson(server, 'POST', '/topics/resolve', {
      names: [{ name: 'Poisoned topic', type: 'tag' }],
    });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'Forbidden' });
    expect(mockResolveNames).not.toHaveBeenCalled();
  });

  it('allows staff users to resolve topic names', async () => {
    currentIsStaff = true;
    mockResolveNames.mockResolvedValue(new Map([['poisoned topic', { slug: 'poisoned-topic' }]]));

    const res = await requestJson(server, 'POST', '/topics/resolve', {
      names: [{ name: 'Poisoned topic', type: 'tag' }],
    });

    expect(res.status).toBe(200);
    expect(mockResolveNames).toHaveBeenCalledWith([{ name: 'Poisoned topic', type: 'tag' }]);
  });

  it('rejects metadata updates for authenticated non-staff users', async () => {
    const res = await requestJson(server, 'PATCH', '/topics/technology', {
      displayName: 'Defaced',
      description: 'Poisoned global metadata',
    });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'Forbidden' });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('allows staff users to update topic metadata', async () => {
    currentIsStaff = true;
    const updatedTopic = { slug: 'technology', displayName: 'Technology' };
    mockFindOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(updatedTopic),
    });

    const res = await requestJson(server, 'PATCH', '/topics/technology', {
      displayName: 'Technology',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(updatedTopic);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { slug: 'technology', isActive: true },
      { $set: { displayName: 'Technology' } },
      { new: true }
    );
  });
});
