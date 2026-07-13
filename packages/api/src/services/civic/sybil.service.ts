/**
 * Sybil Heuristics Service (civic / Commons — Fase 3 personhood anti-gaming).
 *
 * Produces a per-user `sybilPenalty` in [0,1] that `personhoodDerive` subtracts
 * (multiplicatively) from a user's evidence score, so a cluster of fake accounts
 * cannot manufacture personhood by vouching for each other.
 *
 * Two HEURISTIC signals (intentionally simple + auditable — a global,
 * graph-propagation SybilRank-style score is a later refinement that slots in at
 * the {@link computeVouchRingSignal} boundary without changing this function's
 * return contract):
 *
 *  1. SHARED DEVICE CLUSTER — the fraction of a subject's active vouchers
 *     that share an active-session device id with the subject or with one
 *     another. Real vouchers are independent people on independent devices; a
 *     multi-account farm shows a dense identifier overlap. (The coarse
 *     `deviceInfo.fingerprint` is NOT part of the print set — see
 *     `sessionDeviceIds`. IP is NOT a signal — no user IPs at rest.)
 *
 *  2. VOUCH-RING DENSITY — reciprocal (A↔B) and short-cycle (A→B→C→A) vouch
 *     edges around the subject. An organic web-of-trust is broadly acyclic
 *     locally; a sybil ring shows tight cycles among the same handful of ids.
 *
 * The two signals are weighted and capped (`SYBIL_PENALTY_CAP`). Everything is
 * bounded by `SYBIL_VOUCHER_SCAN_CAP` so the cost stays O(vouchers).
 */

import { sessionDeviceIds } from './graphExclusion';
import PersonhoodVouch from '../../models/PersonhoodVouch';
import { clamp } from '../../utils/reputation.constants';
import {
  SYBIL_PENALTY_CAP,
  SYBIL_SHARED_FINGERPRINT_WEIGHT,
  SYBIL_VOUCH_RING_WEIGHT,
  SYBIL_VOUCHER_SCAN_CAP,
} from '../../utils/civic.constants';

/** The sybil signal breakdown — the penalty plus its two raw sub-signals. */
export interface SybilSignal {
  /** Combined, capped penalty in [0, SYBIL_PENALTY_CAP]. */
  penalty: number;
  /** Fraction [0,1] of vouchers in a shared-fingerprint cluster. */
  sharedFingerprintFraction: number;
  /** Vouch-ring density [0,1] around the subject. */
  ringDensity: number;
}

const NO_SYBIL: SybilSignal = { penalty: 0, sharedFingerprintFraction: 0, ringDensity: 0 };

/** The active voucher ids for a subject (capped). */
async function activeVoucherIds(subjectUserId: string): Promise<string[]> {
  const vouches = await PersonhoodVouch.find({ subjectUserId, status: 'active' })
    .select('voucherUserId')
    .limit(SYBIL_VOUCHER_SCAN_CAP)
    .lean<Array<{ voucherUserId: unknown }>>();
  return vouches.map((v) => String(v.voucherUserId));
}

/**
 * Shared-device cluster signal: the fraction of {subject ∪ vouchers} whose
 * active-session deviceIds overlap with at least one OTHER account in the
 * set. Each account's device set is fetched once; overlap is computed by an
 * in-memory inverted index (deviceId → owning accounts), so the cost is
 * O(accounts) queries with no pairwise blow-up.
 */
async function computeSharedFingerprintSignal(
  subjectUserId: string,
  voucherIds: string[],
): Promise<number> {
  const accounts = [subjectUserId, ...voucherIds];
  // fingerprint → set of account ids that present it.
  const owners = new Map<string, Set<string>>();
  const accountPrints = new Map<string, string[]>();

  for (const accountId of accounts) {
    const devices = await sessionDeviceIds(accountId);
    const prints = [...devices].map((d) => `d:${d}`);
    accountPrints.set(accountId, prints);
    for (const print of prints) {
      const set = owners.get(print) ?? new Set<string>();
      set.add(accountId);
      owners.set(print, set);
    }
  }

  // A VOUCHER is "in a cluster" when one of its fingerprints is shared with any
  // other account in the set (the subject themselves do not count toward the
  // fraction — we measure how many VOUCHERS look like the same person/farm).
  let clustered = 0;
  for (const voucherId of voucherIds) {
    const prints = accountPrints.get(voucherId) ?? [];
    const shared = prints.some((print) => (owners.get(print)?.size ?? 0) > 1);
    if (shared) {
      clustered += 1;
    }
  }

  return voucherIds.length === 0 ? 0 : clamp(clustered / voucherIds.length, 0, 1);
}

/**
 * Vouch-ring density signal: reciprocal + short-cycle vouch edges around the
 * subject, normalised by the voucher count.
 *
 *  - reciprocal (2-cycle): the subject vouches back for a voucher (S↔V).
 *  - triad (3-cycle): S→X, X→Y, Y→S, found by joining the subject's OUTGOING
 *    vouchees (X) to their vouchees that land back on an INCOMING voucher (Y).
 *
 * This is the documented extension point: a SybilRank-style trust-propagation
 * score over the full vouch graph would replace/augment this local measure while
 * returning the same [0,1] density.
 */
async function computeVouchRingSignal(
  subjectUserId: string,
  incomingVoucherIds: string[],
): Promise<number> {
  if (incomingVoucherIds.length === 0) {
    return 0;
  }
  const incoming = new Set(incomingVoucherIds);

  const outgoing = await PersonhoodVouch.find({ voucherUserId: subjectUserId, status: 'active' })
    .select('subjectUserId')
    .limit(SYBIL_VOUCHER_SCAN_CAP)
    .lean<Array<{ subjectUserId: unknown }>>();
  const outgoingIds = outgoing.map((v) => String(v.subjectUserId));
  const outgoingSet = new Set(outgoingIds);

  // 2-cycles: subject vouches back for an incoming voucher.
  let reciprocal = 0;
  for (const voucherId of incomingVoucherIds) {
    if (outgoingSet.has(voucherId)) {
      reciprocal += 1;
    }
  }

  // 3-cycles: an edge X→Y with X ∈ outgoing and Y ∈ incoming (X→Y closes
  // S→X→Y→S). Bounded by the capped outgoing/incoming sets.
  let triads = 0;
  if (outgoingIds.length > 0) {
    const bridges = await PersonhoodVouch.find({
      voucherUserId: { $in: outgoingIds },
      subjectUserId: { $in: incomingVoucherIds },
      status: 'active',
    })
      .select('subjectUserId')
      .limit(SYBIL_VOUCHER_SCAN_CAP)
      .lean<Array<{ subjectUserId: unknown }>>();
    triads = bridges.filter((b) => incoming.has(String(b.subjectUserId))).length;
  }

  return clamp((reciprocal + triads) / incomingVoucherIds.length, 0, 1);
}

/**
 * Compute the sybil penalty for a subject from the heuristic signals. Returns
 * the zero signal when the subject has no active vouchers (nothing to cluster).
 */
export async function computeSybilPenalty(subjectUserId: string): Promise<SybilSignal> {
  const voucherIds = await activeVoucherIds(subjectUserId);
  if (voucherIds.length === 0) {
    return NO_SYBIL;
  }

  const [sharedFingerprintFraction, ringDensity] = await Promise.all([
    computeSharedFingerprintSignal(subjectUserId, voucherIds),
    computeVouchRingSignal(subjectUserId, voucherIds),
  ]);

  const penalty = clamp(
    SYBIL_SHARED_FINGERPRINT_WEIGHT * sharedFingerprintFraction +
      SYBIL_VOUCH_RING_WEIGHT * ringDensity,
    0,
    SYBIL_PENALTY_CAP,
  );

  return { penalty, sharedFingerprintFraction, ringDensity };
}
