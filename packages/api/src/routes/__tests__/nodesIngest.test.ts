/**
 * Route-shape tests for the F5b ingest-notify endpoint.
 *
 *  - POST /nodes/ingest/notify/:userId enqueues a background ingest for a user
 *    that HAS a registered node and answers 202.
 *  - A user with no node → 202 but NO enqueue (pure hint, no wasted work).
 *  - An invalid user id → 202 with no model/queue touch.
 *
 * The target is resolved from the path param ONLY; the body is never read. The
 * queue layer, the UserNode model, and the node registry are mocked — no DB, no
 * BullMQ, no network.
 */

const mockEnqueue = jest.fn();
const mockExists = jest.fn();

const USER_ID = '507f1f77bcf86cd799439011';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../queue/nodeIngest.queue', () => ({
  enqueueNodeIngest: (...a: unknown[]) => mockEnqueue(...a),
}));
jest.mock('../../models/UserNode', () => ({
  __esModule: true,
  default: { exists: (...a: unknown[]) => mockExists(...a) },
}));
jest.mock('../../services/nodeRegistry.service', () => ({
  getUserNode: jest.fn(),
  removeNode: jest.fn(),
}));
jest.mock('../../utils/validation', () => ({ isValidObjectId: (id: string) => /^[a-f0-9]{24}$/i.test(id) }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import nodeRoutes from '../nodes';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse { status: number; body: Record<string, unknown>; }

async function post(server: http.Server, path: string): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: 'POST', host: '127.0.0.1', port: address.port, path },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/nodes', nodeRoutes);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});
afterAll((done) => { server.close(done); });
beforeEach(() => { jest.clearAllMocks(); });

describe('POST /nodes/ingest/notify/:userId', () => {
  it('enqueues a background ingest + returns 202 when the user has a node', async () => {
    mockExists.mockResolvedValueOnce({ _id: 'x' });

    const res = await post(server, `/nodes/ingest/notify/${USER_ID}`);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
    expect(mockExists).toHaveBeenCalledWith({ userId: USER_ID, status: { $ne: 'revoked' } });
    expect(mockEnqueue).toHaveBeenCalledWith(USER_ID);
  });

  it('returns 202 WITHOUT enqueueing when the user has no node', async () => {
    mockExists.mockResolvedValueOnce(null);

    const res = await post(server, `/nodes/ingest/notify/${USER_ID}`);

    expect(res.status).toBe(202);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('returns 202 WITHOUT touching the model/queue for an invalid user id', async () => {
    const res = await post(server, '/nodes/ingest/notify/not-an-id');

    expect(res.status).toBe(202);
    expect(mockExists).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
