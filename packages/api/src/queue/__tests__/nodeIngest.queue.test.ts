/**
 * Unit tests for the node-ingest scheduling layer (F5b), in-process fallback.
 *
 *  - `enqueueNodeIngest` DEDUPES per user: two enqueues for the same user before
 *    the drain runs result in a single `ingestFromNode` call.
 *  - `sweepPullNodes` enqueues an ingest for each `mode:'pull'` active node.
 *
 * Queues are forced disabled (`isQueueEnabled → false`) so the in-process path is
 * exercised without BullMQ/Redis. `ingestFromNode`, the UserNode model, the queue
 * connection, and the logger are mocked — no DB and no network.
 */

const mockIngest = jest.fn();
const mockFind = jest.fn();

jest.mock('../../services/nodeSync.service', () => ({ ingestFromNode: (...a: unknown[]) => mockIngest(...a) }));
jest.mock('../../models/UserNode', () => ({ __esModule: true, default: { find: (...a: unknown[]) => mockFind(...a) } }));
jest.mock('../connection', () => ({ getQueueConnectionOptions: jest.fn(() => ({})) }));
jest.mock('../queueManager', () => ({ isQueueEnabled: () => false }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { enqueueNodeIngest, sweepPullNodes } from '../nodeIngest.queue';

/** Drain the floating setImmediate-scheduled drain + its awaited microtasks. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIngest.mockResolvedValue(undefined);
});

describe('enqueueNodeIngest (in-process fallback)', () => {
  it('dedupes: two enqueues for the same user before the drain → one ingest', async () => {
    enqueueNodeIngest('user-1');
    enqueueNodeIngest('user-1');

    await flush();

    expect(mockIngest).toHaveBeenCalledTimes(1);
    expect(mockIngest).toHaveBeenCalledWith('user-1');
  });

  it('runs distinct users independently', async () => {
    enqueueNodeIngest('user-a');
    enqueueNodeIngest('user-b');

    await flush();

    expect(mockIngest).toHaveBeenCalledTimes(2);
    expect(mockIngest).toHaveBeenCalledWith('user-a');
    expect(mockIngest).toHaveBeenCalledWith('user-b');
  });
});

describe('sweepPullNodes', () => {
  it('enqueues an ingest for each pull-mode active node', async () => {
    mockFind.mockReturnValue({
      sort: () => ({
        limit: () => ({
          select: () => ({
            lean: () => Promise.resolve([{ userId: { toString: () => 'n1' } }, { userId: { toString: () => 'n2' } }]),
          }),
        }),
      }),
    });

    await sweepPullNodes();
    await flush();

    const [filter] = mockFind.mock.calls[0];
    expect(filter).toMatchObject({ mode: 'pull' });
    expect(mockIngest).toHaveBeenCalledWith('n1');
    expect(mockIngest).toHaveBeenCalledWith('n2');
  });
});
