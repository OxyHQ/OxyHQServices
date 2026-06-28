/**
 * Node Registry Service (self-sovereign identity layer — F5a user nodes)
 *
 * Materializes and maintains the operational {@link UserNode} cache from the
 * AUTHORITATIVE source — a user's signed `type:'node'` record on their hash
 * chain (`collection: 'app.oxy.node'`, `rkey: 'self'`). The signed record is
 * verified + stored by the existing `POST /identity/records` path; this service
 * is the focused hook that projects its `record` payload into the fast cache and
 * keeps the liveness badge current.
 *
 * ## Absolute read-path invariant
 *
 * Every node fetch here goes through `@oxyhq/core/server`'s `safeFetch`
 * (HTTPS-only, private-IP denylist, DNS-pinned, bounded redirects) and runs ONLY
 * in the background — the post-registration probe (fire-and-forget) and the
 * periodic sweep. No function in a request's read path ever awaits a node: a
 * down node leaves the cache stale-but-instant. `probeLiveness` and
 * `sweepNodeLiveness` NEVER throw into a caller.
 */

import type { UpdateQuery } from 'mongoose';
import { z } from 'zod';
import { safeFetch } from '@oxyhq/core/server';
import UserNode, { type IUserNode, type UserNodeMode } from '../models/UserNode';
import userCache from '../utils/userCache';
import { logger } from '../utils/logger';
import {
  NODE_WELL_KNOWN_PATH,
  NODE_PROBE_TIMEOUT_MS,
  NODE_LAST_ERROR_MAX_LEN,
  NODE_LIVENESS_SWEEP_BATCH,
} from '../utils/nodes.constants';

/**
 * Shape of the `record` payload inside a signed `type:'node'` envelope. Only
 * these fields are projected into the cache; anything else is ignored. Kept API-
 * internal (not a published `@oxyhq/contracts` schema) until F5 stabilises.
 */
const nodeRecordSchema = z.object({
  endpoint: z.string().trim().min(1),
  nodePublicKey: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64,130}$/, 'nodePublicKey must be a secp256k1 hex key'),
  mode: z.enum(['pull', 'push']).optional(),
  nodeDid: z.string().trim().min(1).optional(),
});

/**
 * Validate + normalise a node endpoint. Returns the canonical `origin + path`
 * (trailing slash trimmed) only for a well-formed, credential-free HTTPS URL;
 * `null` otherwise. The SSRF/private-IP check itself happens later in `safeFetch`
 * at probe time — here we only reject endpoints that could never be a valid node
 * (so junk never reaches the DID document).
 */
function normalizeHttpsEndpoint(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username.length > 0 || url.password.length > 0) return null;
  if (url.hostname.length === 0) return null;
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** The liveness manifest URL for a normalised node endpoint. */
function wellKnownUrl(endpoint: string): string {
  return `${endpoint}${NODE_WELL_KNOWN_PATH}`;
}

/**
 * Project a verified `type:'node'` signed record into the {@link UserNode} cache.
 *
 * Best-effort and non-throwing: the signed record is the source of truth and is
 * already persisted on the chain by the caller; a malformed `record` payload
 * (bad endpoint/key) simply skips materialization (logged) rather than failing
 * the request. On success the row is upserted `active`, the user cache is
 * invalidated (the DID document's `#oxy-node` service entry changed), and a
 * liveness probe is fired WITHOUT being awaited.
 */
export async function materializeNodeFromRecord(
  userId: string,
  record: Record<string, unknown>,
): Promise<IUserNode | null> {
  const parsed = nodeRecordSchema.safeParse(record);
  if (!parsed.success) {
    logger.warn('node record payload failed validation; skipping materialization', {
      component: 'nodeRegistry',
      userId,
    });
    return null;
  }

  const endpoint = normalizeHttpsEndpoint(parsed.data.endpoint);
  if (!endpoint) {
    logger.warn('node record endpoint is not a valid HTTPS URL; skipping materialization', {
      component: 'nodeRegistry',
      userId,
    });
    return null;
  }

  const mode: UserNodeMode = parsed.data.mode ?? 'pull';

  try {
    const node = await UserNode.findOneAndUpdate(
      { userId },
      {
        $set: {
          endpoint,
          nodePublicKey: parsed.data.nodePublicKey,
          mode,
          status: 'active',
          ...(parsed.data.nodeDid ? { nodeDid: parsed.data.nodeDid } : {}),
        },
        $unset: { lastError: '' },
        $setOnInsert: { userId },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // The DID document derives its `#oxy-node` service entry from this row, so a
    // (re)registration changes user-facing state — invalidate the user cache.
    userCache.invalidate(userId);

    // Fire-and-forget liveness probe — NEVER awaited in the request path.
    probeLiveness(userId).catch((err) =>
      logger.debug('post-registration node liveness probe failed to schedule', {
        component: 'nodeRegistry',
        userId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    return node;
  } catch (err) {
    logger.error(
      'failed to materialize UserNode from signed record',
      err instanceof Error ? err : new Error(String(err)),
      { component: 'nodeRegistry', userId },
    );
    return null;
  }
}

/**
 * Background liveness probe for a single user's node. Fetches the node's
 * `/.well-known/oxy-node.json` over `safeFetch` (SSRF-safe) and updates the
 * cached badge: a 2xx → `active` + `lastSeenAt`; anything else (or a thrown
 * fetch error) → `unreachable` + `lastError`. Never throws and never reads more
 * than the response headers (the body is destroyed immediately — only liveness
 * matters here). A `revoked` node is skipped.
 */
export async function probeLiveness(userId: string): Promise<void> {
  try {
    const node = await UserNode.findOne({ userId, status: { $ne: 'revoked' } })
      .select('endpoint')
      .lean<{ endpoint: string } | null>();
    if (!node) {
      return;
    }

    const probeAt = new Date();
    let update: UpdateQuery<IUserNode>;

    try {
      const result = await safeFetch(wellKnownUrl(node.endpoint), {
        headersTimeoutMs: NODE_PROBE_TIMEOUT_MS,
        maxRedirects: 1,
      });
      // Liveness only needs the status line — drop the body without reading it.
      result.response.destroy();

      if (result.status >= 200 && result.status < 300) {
        update = {
          $set: { status: 'active', lastSeenAt: probeAt, lastProbeAt: probeAt },
          $unset: { lastError: '' },
        };
      } else {
        update = {
          $set: {
            status: 'unreachable',
            lastProbeAt: probeAt,
            lastError: `node responded with HTTP ${result.status}`.slice(0, NODE_LAST_ERROR_MAX_LEN),
          },
        };
      }
    } catch (fetchErr) {
      const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      update = {
        $set: {
          status: 'unreachable',
          lastProbeAt: probeAt,
          lastError: message.slice(0, NODE_LAST_ERROR_MAX_LEN),
        },
      };
      logger.debug('node liveness probe failed', { component: 'nodeRegistry', userId, error: message });
    }

    await UserNode.updateOne({ userId, status: { $ne: 'revoked' } }, update);
  } catch (err) {
    // A DB error during a background probe must never escape — log and move on.
    logger.error(
      'node liveness probe encountered an error',
      err instanceof Error ? err : new Error(String(err)),
      { component: 'nodeRegistry', userId },
    );
  }
}

/**
 * Re-probe a bounded batch of registered nodes (least-recently-probed first).
 * Sequential to bound the outbound concurrency; each probe is independent and
 * non-throwing. Called by the unref'd background sweep in `server.ts`.
 */
export async function sweepNodeLiveness(): Promise<void> {
  const nodes = await UserNode.find({ status: { $in: ['active', 'unreachable'] } })
    .sort({ lastProbeAt: 1 })
    .limit(NODE_LIVENESS_SWEEP_BATCH)
    .select('userId')
    .lean<Array<{ userId: { toString(): string } }>>();

  for (const node of nodes) {
    await probeLiveness(node.userId.toString());
  }
}

/** The cached node row for a user (any status), or `null`. */
export async function getUserNode(userId: string): Promise<IUserNode | null> {
  return UserNode.findOne({ userId }).lean<IUserNode | null>();
}

/**
 * Revoke a user's node registration (mark `revoked` so it leaves the DID document
 * and the liveness sweeps). Returns `true` when a non-revoked row was flipped.
 * Invalidates the user cache because the DID `#oxy-node` service entry changed.
 */
export async function removeNode(userId: string): Promise<boolean> {
  const result = await UserNode.updateOne(
    { userId, status: { $ne: 'revoked' } },
    { $set: { status: 'revoked' }, $unset: { lastError: '' } },
  );
  const changed = result.modifiedCount > 0;
  if (changed) {
    userCache.invalidate(userId);
  }
  return changed;
}
