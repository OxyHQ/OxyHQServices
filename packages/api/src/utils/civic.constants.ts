/**
 * Civic / Commons constants (Fase 2 — anti-gaming layer).
 *
 * SINGLE SOURCE OF TRUTH for the tunables of the real-life attestation flow and
 * (Fase 2 Part B) the validator jury. Nothing in the civic services may hardcode
 * these — import them here so the anti-sybil knobs stay in one auditable place.
 */

/* -------------------------------------------------------------------------- */
/*  Real-life counterparty attestation (Part A)                               */
/* -------------------------------------------------------------------------- */

/**
 * Max age of a real-life attestation QR/nonce. A counterparty's signed
 * submission is rejected once `record.exp` (epoch ms) is in the past; the QR's
 * `exp` should be no further out than this from when it was shown.
 */
export const REAL_LIFE_NONCE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Per-pair cooldown: a given counterparty (B) may attest the same subject (A) at
 * most once per this window, even with a fresh QR — defence against a colluding
 * pair farming HIGH-weight points.
 */
export const REAL_LIFE_PAIR_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Graph-exclusion hop radius for the real-life flow: the counterparty must not
 * be within this many social-graph hops of the subject (1 = direct neighbour).
 */
export const REAL_LIFE_EXCLUSION_HOPS = 1;

/* -------------------------------------------------------------------------- */
/*  Validator jury (Part B)                                                   */
/* -------------------------------------------------------------------------- */

/** Trust tiers eligible to serve on a validation jury (never `restricted`/`new`). */
export const VALIDATOR_POOL_TIERS = ['trusted', 'high_trust', 'verified'] as const;

/** Number of validators selected per request. */
export const VALIDATOR_COUNT = 5;

/** Minimum votes before a request can be tallied (normal value). */
export const VALIDATOR_QUORUM = 3;

/** Votes required on the winning side for a HIGH-VALUE request (supermajority). */
export const VALIDATOR_SUPERMAJORITY = 4;

/** A juror must not be within this many social-graph hops of the subject. */
export const VALIDATION_EXCLUSION_HOPS = 2;

/** How long a validation request stays open for votes before it expires. */
export const VALIDATION_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Max prior co-votes a candidate juror may share with an already-selected juror
 * before being skipped (collusion-cluster throttle).
 */
export const AFFINITY_MAX_COVOTES = 3;

/**
 * Cap on the candidate pool scanned per selection — bounds the work and the
 * `candidateSnapshot` size while staying far larger than `VALIDATOR_COUNT`.
 */
export const VALIDATOR_POOL_CAP = 500;

/** How often the background sweep re-tallies / expires stale validation requests. */
export const VALIDATION_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
