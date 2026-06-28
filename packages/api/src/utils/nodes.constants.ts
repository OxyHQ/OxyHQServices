/**
 * User-node constants (F5a — decentralization / personal data nodes).
 *
 * SINGLE SOURCE OF TRUTH for the tunables of node registration, the liveness
 * probe, and the background liveness sweep. Nothing in the node services may
 * hardcode these — import them here.
 */

/**
 * AtProto-style collection (NSID) carried by a signed `type:'node'` record. The
 * record's `rkey` is fixed to {@link NODE_RKEY} so a user has exactly ONE active
 * node registration (last-writer-wins on the chain's `(collection, rkey)` key).
 */
export const NODE_COLLECTION = 'app.oxy.node';

/** The single record key for a user's node registration (one node per user). */
export const NODE_RKEY = 'self';

/** The DID-document service `type` announced for a user's personal data node. */
export const OXY_NODE_SERVICE_TYPE = 'OxyPersonalDataNode';

/** The DID-document service-id fragment for a user's personal data node. */
export const OXY_NODE_SERVICE_FRAGMENT = '#oxy-node';

/**
 * The well-known liveness manifest a node serves. The probe fetches this over
 * HTTPS via `safeFetch`; a 2xx means the node is reachable.
 */
export const NODE_WELL_KNOWN_PATH = '/.well-known/oxy-node.json';

/** Time-to-first-byte deadline for a liveness probe (kept short — background). */
export const NODE_PROBE_TIMEOUT_MS = 5_000;

/** Max bytes read from a liveness probe response before the stream is destroyed. */
export const NODE_PROBE_MAX_BYTES = 64 * 1024;

/** Max length of a stored `lastError` string (keeps the row bounded). */
export const NODE_LAST_ERROR_MAX_LEN = 300;

/** How often the background sweep re-probes registered nodes. */
export const NODE_LIVENESS_SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** Max nodes re-probed per sweep (bounds the background work). */
export const NODE_LIVENESS_SWEEP_BATCH = 100;
