/**
 * Link-preview warm-queue tests:
 *  - the per-URL BullMQ job id MUST be colon-free ("Custom Id cannot contain :").
 *  - the BullMQ Worker MUST be created with an explicit `concurrency` (BullMQ
 *    defaults to 1, which drains a backfill far too slowly).
 */

// MockWorker records the LAST options object it was constructed with, so the
// test can assert `concurrency` was passed without capturing outer variables.
jest.mock('bullmq', () => {
  class MockWorker {
    static lastOptions: { concurrency?: number } | undefined;
    constructor(_name: unknown, _processor: unknown, options: { concurrency?: number }) {
      MockWorker.lastOptions = options;
    }
    on(): this {
      return this;
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  }
  class MockQueue {
    on(): this {
      return this;
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
    add(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

const mockIsQueueEnabled = jest.fn(() => false);

jest.mock('../connection', () => ({ getQueueConnectionOptions: () => ({}) }));
jest.mock('../queueManager', () => ({ isQueueEnabled: () => mockIsQueueEnabled() }));
jest.mock('../../services/linkPreview/linkPreviewService', () => ({
  linkPreviewService: { resolveAndStore: jest.fn() },
}));

import { Worker } from 'bullmq';
import {
  linkPreviewWarmJobId,
  startLinkPreviewWarmJobs,
  stopLinkPreviewWarmJobs,
} from '../linkPreviewWarm.queue';
import { LINK_PREVIEW_WARM_CONCURRENCY } from '../../services/linkPreview/constants';

describe('linkPreviewWarmJobId', () => {
  it('never contains a colon (BullMQ custom-id rule) and is stable per URL', () => {
    const url = 'https://youtu.be/mYDSSRS-B5U';
    const id = linkPreviewWarmJobId(url);
    expect(id).not.toContain(':');
    expect(id.startsWith('lp-')).toBe(true);
    expect(linkPreviewWarmJobId(url)).toBe(id); // deterministic
    expect(linkPreviewWarmJobId('https://vimeo.com/76979871')).not.toBe(id);
  });
});

describe('warm worker concurrency', () => {
  afterEach(async () => {
    await stopLinkPreviewWarmJobs();
    mockIsQueueEnabled.mockReturnValue(false);
  });

  it('creates the BullMQ Worker with an explicit concurrency (not the default 1)', async () => {
    mockIsQueueEnabled.mockReturnValue(true);
    await startLinkPreviewWarmJobs();

    const opts = (Worker as unknown as { lastOptions?: { concurrency?: number } }).lastOptions;
    expect(opts?.concurrency).toBe(LINK_PREVIEW_WARM_CONCURRENCY);
    expect(LINK_PREVIEW_WARM_CONCURRENCY).toBeGreaterThanOrEqual(2);
  });
});
