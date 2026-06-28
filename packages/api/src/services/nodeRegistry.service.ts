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
import { signedRecordSigningInput } from '@oxyhq/core';
import { safeFetch } from '@oxyhq/core/server';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';
import UserNode, { type IUserNode, type UserNodeMode, type UserNodeController } from '../models/UserNode';
import { User } from '../models/User';
import SignatureService from './signature.service';
import { buildUserDid, OXY_DID } from './did.service';
import { getHead } from './repoLog.service';
import { verifyAndStoreRecord } from './signedRecord.service';
import userCache from '../utils/userCache';
import { logger } from '../utils/logger';
import {
  NODE_WELL_KNOWN_PATH,
  NODE_PROBE_TIMEOUT_MS,
  NODE_LAST_ERROR_MAX_LEN,
  NODE_LIVENESS_SWEEP_BATCH,
  NODE_COLLECTION,
  NODE_RKEY,
  MANAGED_NODE_BASE_URL_ENV,
  MANAGED_NODE_USER_PATH_PREFIX,
  MANAGED_NODE_PUBLIC_KEY_ENV,
  MANAGED_NODE_MODE,
} from '../utils/nodes.constants';

/** `ES256K-DER-SHA256` — the only signature alg carried by a signed record. */
const SIGNED_RECORD_ALG = 'ES256K-DER-SHA256' as const;

/** Retry budget for the multi-writer chain-head race when appending the node record. */
const MAX_PROVISION_ATTEMPTS = 4;

/**
 * How a managed `type:'node'` record was projected into the cache. Self-hosted
 * registrations omit this (defaults below); the F5c managed path passes it.
 */
export interface MaterializeNodeOptions {
  /** Oxy operates this node on the user's behalf (F5c managed vault). Default `false`. */
  managed?: boolean;
  /** Operator of the node. Default `self`. */
  controller?: UserNodeController;
}

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
 *
 * `options` records WHO operates the node: self-hosted by default, or
 * `{ managed: true, controller: 'oxy' }` for an F5c managed vault. Both flags are
 * written every time so re-registering a self-hosted node over a previously
 * managed one (or vice-versa) flips the operator deterministically.
 */
export async function materializeNodeFromRecord(
  userId: string,
  record: Record<string, unknown>,
  options: MaterializeNodeOptions = {},
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
  const managed = options.managed ?? false;
  const controller: UserNodeController = options.controller ?? 'self';

  try {
    const node = await UserNode.findOneAndUpdate(
      { userId },
      {
        $set: {
          endpoint,
          nodePublicKey: parsed.data.nodePublicKey,
          mode,
          managed,
          controller,
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
 *
 * Operator-agnostic: it revokes a self-hosted node and an F5c MANAGED vault
 * identically — flipping `status` to `revoked` is the entire control-plane action.
 *
 * ## Managed-vault teardown seam (infra, out-of-band)
 *
 * For a managed vault (`managed:true, controller:'oxy'`) the underlying container
 * + on-disk storage are an INFRASTRUCTURE concern, not an API concern. Revoking
 * here is the durable, idempotent signal: a node-fleet reconciler tears down (or
 * archives) the per-user volume by reconciling against
 * `UserNode.find({ managed: true, controller: 'oxy', status: 'revoked' })`. The
 * API never reaches the node inline (the read-path invariant), so this stays a
 * pure local DB write; the heavy teardown happens asynchronously in the fleet.
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

/* -------------------------------------------------------------------------- */
/*  F5c — managed vault provisioning                                          */
/* -------------------------------------------------------------------------- */

/** Why {@link provisionManagedVault} could not provision a managed vault. */
export type ManagedVaultFailureReason =
  | 'oxy_key_unconfigured'
  | 'managed_endpoint_unconfigured'
  | 'user_not_found'
  | 'provision_failed';

/** Result of {@link provisionManagedVault} — the active row, or a clear reason. */
export type ProvisionManagedVaultResult =
  | { ok: true; node: IUserNode }
  | { ok: false; reason: ManagedVaultFailureReason };

/** The managed node's signing public key: a dedicated fleet key, else the Oxy custodial key. */
function resolveManagedNodePublicKey(): string | undefined {
  return process.env[MANAGED_NODE_PUBLIC_KEY_ENV] || process.env.OXY_PUBLIC_KEY || undefined;
}

/**
 * Derive the managed-node endpoint for a user from `MANAGED_NODE_BASE_URL`
 * (`${base}/u/${userId}`), validated/normalised as a credential-free HTTPS URL.
 * Returns `null` when the base is unset or not a usable HTTPS base — provisioning
 * then fails closed rather than registering a junk endpoint.
 */
function resolveManagedEndpoint(userId: string): string | null {
  const base = process.env[MANAGED_NODE_BASE_URL_ENV];
  if (!base) {
    return null;
  }
  const trimmed = base.replace(/\/+$/, '');
  return normalizeHttpsEndpoint(`${trimmed}${MANAGED_NODE_USER_PATH_PREFIX}${userId}`);
}

/**
 * Provision (or refresh) an Oxy-operated MANAGED vault for `userId` — the F5c
 * "Create your vault" convenience for non-technical users.
 *
 * Oxy custodial-signs a `type:'node'` record onto the user's hash chain (issuer =
 * `OXY_DID`, signed by the Oxy custodial key — the SAME mechanism as the
 * reputation attestation, signed export, and F5b ingest witness), runs it through
 * the shared {@link verifyAndStoreRecord} so it lands on the chain exactly like a
 * self-signed node record, then materializes the {@link UserNode} cache as
 * `managed:true, controller:'oxy', status:'active'` and fires the async liveness
 * probe. `userCache.invalidate` lets the DID `#oxy-node` service entry resolve.
 *
 * Fails closed: with no Oxy custodial key (`oxy_key_unconfigured`) or no
 * configured managed-node base URL (`managed_endpoint_unconfigured`) it returns a
 * clear error instead of creating a broken vault.
 *
 * Idempotent: re-provisioning while an active managed vault already exists at the
 * same endpoint is a no-op refresh (re-probe + cache invalidate) — it does NOT
 * append another chain record. The container/storage orchestration itself is
 * INFRA (a node-fleet reconciler stands up the per-user volume off the active
 * managed `UserNode` row); this layer only writes the cryptographic registration.
 */
export async function provisionManagedVault(userId: string): Promise<ProvisionManagedVaultResult> {
  const privateKey = process.env.OXY_PRIVATE_KEY;
  const oxyPublicKey = process.env.OXY_PUBLIC_KEY;
  if (!privateKey || !oxyPublicKey) {
    logger.warn('Managed vault refused: OXY_PRIVATE_KEY/OXY_PUBLIC_KEY not configured', {
      component: 'nodeRegistry',
      userId,
    });
    return { ok: false, reason: 'oxy_key_unconfigured' };
  }

  const endpoint = resolveManagedEndpoint(userId);
  if (!endpoint) {
    logger.warn('Managed vault refused: MANAGED_NODE_BASE_URL unset or not a valid HTTPS base', {
      component: 'nodeRegistry',
      userId,
    });
    return { ok: false, reason: 'managed_endpoint_unconfigured' };
  }

  const nodePublicKey = resolveManagedNodePublicKey();
  if (!nodePublicKey) {
    // Unreachable while `oxyPublicKey` is set, but keeps the result type total.
    return { ok: false, reason: 'oxy_key_unconfigured' };
  }

  const user = await User.findById(userId).select('_id').lean<{ _id: unknown } | null>();
  if (!user) {
    return { ok: false, reason: 'user_not_found' };
  }

  // Idempotency: an already-active managed vault at this endpoint is a no-op
  // refresh — re-assert the cache + re-probe, but do NOT grow the chain.
  const existing = await getUserNode(userId);
  if (
    existing &&
    existing.managed === true &&
    existing.controller === 'oxy' &&
    existing.status !== 'revoked' &&
    existing.endpoint === endpoint
  ) {
    userCache.invalidate(userId);
    probeLiveness(userId).catch((err) =>
      logger.debug('managed vault refresh probe failed to schedule', {
        component: 'nodeRegistry',
        userId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: true, node: existing };
  }

  const subjectDid = buildUserDid(userId);
  const record: Record<string, unknown> = {
    endpoint,
    nodePublicKey,
    mode: MANAGED_NODE_MODE,
    managed: true,
  };

  let stored = false;
  for (let attempt = 0; attempt < MAX_PROVISION_ATTEMPTS; attempt += 1) {
    const head = await getHead(userId);
    const seq = head ? head.seq + 1 : 0;
    const prev = head ? head.headRecordId : null;

    const fields: Omit<SignedRecordEnvelope, 'signature'> = {
      version: 2,
      type: 'node',
      subject: subjectDid,
      issuer: OXY_DID,
      record,
      issuedAt: Date.now(),
      seq,
      prev,
      collection: NODE_COLLECTION,
      rkey: NODE_RKEY,
      publicKey: oxyPublicKey,
      alg: SIGNED_RECORD_ALG,
    };
    const signature = SignatureService.signMessage(signedRecordSigningInput(fields), privateKey);
    const envelope: SignedRecordEnvelope = { ...fields, signature };

    // The subject account's own verification methods are NOT consulted for a
    // custodial record (issuer === OXY_DID), so an empty subject suffices.
    const result = await verifyAndStoreRecord(envelope, { publicKey: null, authMethods: [] }, userId);
    if (result.ok) {
      stored = true;
      break;
    }

    // A concurrent writer advanced the chain head between our read and write —
    // re-read the head and retry. Anything else is a hard failure.
    if (result.reason === 'chain_conflict' || result.reason === 'bad_seq' || result.reason === 'chain_fork') {
      continue;
    }

    logger.warn('Managed vault node record rejected', {
      component: 'nodeRegistry',
      userId,
      reason: result.reason,
    });
    return { ok: false, reason: 'provision_failed' };
  }

  if (!stored) {
    logger.warn('Managed vault abandoned after chain-race retries', {
      component: 'nodeRegistry',
      userId,
    });
    return { ok: false, reason: 'provision_failed' };
  }

  // Project the just-signed record into the operational cache as an Oxy-operated
  // managed node (active) + fire the async liveness probe + invalidate the user
  // cache (so the DID `#oxy-node` service entry resolves).
  const node = await materializeNodeFromRecord(userId, record, { managed: true, controller: 'oxy' });
  if (!node) {
    logger.error(
      'Managed vault chain record stored but cache materialization failed',
      new Error('materializeNodeFromRecord returned null'),
      { component: 'nodeRegistry', userId },
    );
    return { ok: false, reason: 'provision_failed' };
  }

  return { ok: true, node };
}
