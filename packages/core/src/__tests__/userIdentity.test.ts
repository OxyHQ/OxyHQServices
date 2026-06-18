import { OxyServices } from '../OxyServices';
import { getNormalizedUserId, normalizeUserIdentity } from '../utils/userIdentity';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function createJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

describe('user identity normalization', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('normalizes Mongo _id to id', () => {
    expect(getNormalizedUserId({ _id: 'mongo_id' })).toBe('mongo_id');
    expect(normalizeUserIdentity({ _id: 'mongo_id', username: 'nate' })).toEqual({
      _id: 'mongo_id',
      id: 'mongo_id',
      username: 'nate',
    });
  });

  it('normalizes getCurrentUser responses before exposing them to apps', async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      return jsonResponse({ _id: 'user_1', username: 'nate', publicKey: 'pub_1' });
    };

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    oxy.setTokens(createJwt({
      userId: 'user_1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }));
    const user = await oxy.getCurrentUser();

    expect(user.id).toBe('user_1');
    expect(user.username).toBe('nate');
    expect(calls[0].url).toBe('https://api.oxy.so/users/me');
  });

  it('normalizes validateSession users before services stores them', async () => {
    globalThis.fetch = async () =>
      jsonResponse({
        valid: true,
        expiresAt: '2099-01-01T00:00:00.000Z',
        lastActivity: '2026-06-18T00:00:00.000Z',
        user: { _id: 'user_1', username: 'nate', publicKey: 'pub_1' },
      });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const validation = await oxy.validateSession('session_1', { useHeaderValidation: true });

    expect(validation.user.id).toBe('user_1');
    expect(validation.user.username).toBe('nate');
  });
});
