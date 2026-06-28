/**
 * Static, env-independent constants for the Oxy personal data node.
 *
 * Values that an operator may want to tune (port, data dir, owner key, mode,
 * blob ceiling) are read from the environment in {@link ./config.ts}; the values
 * here are protocol/shape constants that are part of the node's contract.
 */

/**
 * The node-protocol version advertised at `/.well-known/oxy-node.json`. Bumped
 * only on a breaking change to the wire shape of the log / head / record APIs.
 */
export const PROTOCOL_VERSION = 'oxy-node/1' as const;

/** Default HTTP port when `OXY_NODE_PORT` is unset (always overridable via env). */
export const DEFAULT_PORT = 4000;

/** Default and maximum number of log entries returned by `GET /oxy/log`. */
export const DEFAULT_LOG_LIMIT = 100;
export const MAX_LOG_LIMIT = 500;

/** Default upper bound on a single pinned blob's size when `OXY_NODE_MAX_BLOB_BYTES` is unset. */
export const DEFAULT_MAX_BLOB_BYTES = 25 * 1024 * 1024; // 25 MiB

/** Maximum number of envelopes accepted in one `POST /sync/push` batch. */
export const MAX_SYNC_BATCH = 200;

/** Body-size ceiling for JSON request bodies (`/records`, `/sync/push`). */
export const JSON_BODY_LIMIT = '5mb';

/** HTTP headers carrying an owner-signed action authorization (blob pins). */
export const OWNER_AUTH_HEADERS = {
  publicKey: 'x-oxy-node-public-key',
  signature: 'x-oxy-node-signature',
  timestamp: 'x-oxy-node-timestamp',
} as const;

/**
 * Freshness window for an owner-signed action (e.g. a blob pin). A signed
 * authorization header older/newer than this (accounting for clock skew) is
 * rejected, bounding replay of a captured pin authorization.
 */
export const OWNER_AUTH_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/** Operating modes a node can advertise. */
export const NODE_MODES = ['self-hosted', 'managed'] as const;
export type NodeMode = (typeof NODE_MODES)[number];

/** The two node operations an owner can authorize with a signed header. */
export const OWNER_ACTION_BLOB_PIN = 'blob-pin' as const;

/** A 32-byte (64 hex char) lowercase SHA-256 digest, used as the blob address. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;
