/**
 * Background warming for the link-preview service.
 *
 * The single decision point for HOW first-seen / stale URLs get resolved off the
 * response path, mirroring `nodeIngest.queue.ts`:
 *
 *   - **BullMQ path** (`REDIS_URL` set): on-demand per-URL warm jobs deduped by a
 *     stable per-URL jobId, so a URL already queued/active is never enqueued
 *     twice — and the dedup is fleet-wide (cross-instance single-flight at the
 *     queue layer, complemented by the Redis resolve lock in `linkPreviewCache`).
 *     One in-process worker drains the queue.
 *
 *   - **In-process fallback** (no `REDIS_URL`, e.g. local dev / tests): a deduped
 *     in-process pending set drained sequentially — same single-flight semantics,
 *     no Redis required.
 *
 * NOTHING here is awaited on a request's read path. `enqueueLinkPreviewWarm` is a
 * fire-and-forget hint; the actual remote I/O lives in
 * `linkPreviewService.resolveAndStore` (SSRF-safe, background only).
 *
 * Queue name MUST NOT contain `:` (BullMQ throws) — `link-preview-warm`.
 */

import { createHash } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import { logger } from '../utils/logger';
import { getQueueConnectionOptions } from './connection';
import { isQueueEnabled } from './queueManager';
import { COMPLETED_JOBS_RETENTION, FAILED_JOBS_RETENTION } from './constants';
import { linkPreviewService } from '../services/linkPreview/linkPreviewService';

/** BullMQ queue name (no `:` allowed). */
const LINK_PREVIEW_WARM_QUEUE = 'link-preview-warm';
/** Job name for a single-URL warm. */
const LINK_PREVIEW_WARM_JOB = 'warm';

interface LinkPreviewWarmJobData {
  url: string;
}

/** Stable per-URL job id so a URL already queued/active is never enqueued twice. */
function jobIdFor(url: string): string {
  return `warm:${createHash('sha256').update(url).digest('hex')}`;
}

/* -------------------------------------------------------------------------- */
/*  BullMQ path                                                               */
/* -------------------------------------------------------------------------- */

let queue: Queue<LinkPreviewWarmJobData> | null = null;
let worker: Worker<LinkPreviewWarmJobData> | null = null;

/* -------------------------------------------------------------------------- */
/*  In-process fallback                                                       */
/* -------------------------------------------------------------------------- */

const pending = new Set<string>();
const inFlight = new Set<string>();
let draining = false;
let stopped = false;

/**
 * Sequentially drain the in-process pending set (bounds outbound concurrency to
 * one resolve at a time). Self-guards against overlapping drains and exits once
 * `stopped`. Each resolve is non-throwing (`resolveAndStore` never throws); a
 * stray error is still caught so the drain never dies.
 */
async function drainInProcess(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (pending.size > 0 && !stopped) {
      const url = pending.values().next().value as string;
      pending.delete(url);
      if (inFlight.has(url)) continue;
      inFlight.add(url);
      try {
        await linkPreviewService.resolveAndStore(url);
      } catch (err) {
        logger.error(
          'In-process link-preview warm failed',
          err instanceof Error ? err : new Error(String(err)),
          { component: 'linkPreviewWarm', url },
        );
      } finally {
        inFlight.delete(url);
      }
    }
  } finally {
    draining = false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Schedule a background resolve for `url` — a deduped, fire-and-forget hint.
 * With BullMQ it adds a per-URL job (jobId derived from the URL) that BullMQ
 * ignores while one is already queued/active. In the fallback it adds to the
 * in-process pending set (skipped if already pending or in flight) and kicks a
 * drain on the next tick. NEVER throws into the caller.
 */
export function enqueueLinkPreviewWarm(url: string): void {
  if (queue) {
    void queue
      .add(
        LINK_PREVIEW_WARM_JOB,
        { url },
        {
          jobId: jobIdFor(url),
          removeOnComplete: COMPLETED_JOBS_RETENTION,
          removeOnFail: FAILED_JOBS_RETENTION,
        },
      )
      .catch((err: unknown) =>
        logger.warn('Failed to enqueue link-preview warm job', {
          component: 'linkPreviewWarm',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return;
  }

  if (stopped) return;
  if (pending.has(url) || inFlight.has(url)) return;
  pending.add(url);
  setImmediate(() => {
    void drainInProcess();
  });
}

/**
 * Start the link-preview warm subsystem. BullMQ (durable, fleet-wide) when queues
 * are enabled, otherwise the in-process pending-set fallback. Never throws — a
 * queue setup failure logs and falls back to in-process.
 */
export async function startLinkPreviewWarmJobs(): Promise<void> {
  stopped = false;

  if (!isQueueEnabled()) {
    logger.info('Link-preview warm using in-process fallback (REDIS_URL unset)');
    return;
  }

  try {
    queue = new Queue<LinkPreviewWarmJobData>(LINK_PREVIEW_WARM_QUEUE, {
      connection: getQueueConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: COMPLETED_JOBS_RETENTION,
        removeOnFail: FAILED_JOBS_RETENTION,
      },
    });
    queue.on('error', (err: Error) =>
      logger.error('Link-preview warm queue error', { error: err.message }),
    );

    worker = new Worker<LinkPreviewWarmJobData>(
      LINK_PREVIEW_WARM_QUEUE,
      async (job: Job<LinkPreviewWarmJobData>) => {
        const url = job.data.url;
        if (url) {
          await linkPreviewService.resolveAndStore(url);
        }
      },
      { connection: getQueueConnectionOptions() },
    );
    worker.on('failed', (job, err: Error) =>
      logger.error('Link-preview warm job failed', { jobId: job?.id, error: err.message }),
    );
    worker.on('error', (err: Error) =>
      logger.error('Link-preview warm worker error', { error: err.message }),
    );

    logger.info('Link-preview warm started via BullMQ (durable, fleet-wide dedup)');
  } catch (err) {
    logger.error(
      'Link-preview warm BullMQ setup failed — falling back to in-process',
      err instanceof Error ? err : new Error(String(err)),
    );
    await teardownQueue();
  }
}

/** Close the BullMQ worker + queue (and the connections they own). */
async function teardownQueue(): Promise<void> {
  const w = worker;
  const q = queue;
  worker = null;
  queue = null;
  if (w) {
    await w.close().catch((err) =>
      logger.warn('Link-preview warm worker close failed', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  if (q) {
    await q.close().catch((err) =>
      logger.warn('Link-preview warm queue close failed', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Stop the link-preview warm subsystem. Closes BullMQ resources and clears the
 * fallback set. Safe to call regardless of which path ran. Intended for the
 * server's graceful-shutdown sequence (BEFORE the shared Redis client closes).
 */
export async function stopLinkPreviewWarmJobs(): Promise<void> {
  stopped = true;
  pending.clear();
  await teardownQueue();
}
