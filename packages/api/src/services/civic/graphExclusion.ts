/**
 * Graph-exclusion utility (civic / Commons — Fase 2 anti-sybil core).
 *
 * The SHARED sock-puppet test used by BOTH the real-life attestation flow
 * (counterparty must not be the subject's puppet) and the validator jury
 * selection (a candidate juror related to the subject is excluded). Centralised
 * here so both paths apply identical rules.
 *
 * Two signals:
 *  1. SOCIAL GRAPH — a directed/undirected edge via `Follow` (user follows) or
 *     `Block` (either direction), within a configurable hop radius (1 = direct
 *     neighbour; 2 = shares a common neighbour). Two-hop is computed as the
 *     intersection of the two users' direct-neighbour sets (bounded, no BFS
 *     blow-up).
 *  2. SHARED DEVICE / IP — an overlap in the `deviceId` / device fingerprint /
 *     IP of the two users' active sessions (a classic multi-account signal).
 *
 * `Contact` is intentionally NOT used: it keys on email, not a resolved Oxy
 * user id, so it does not yield a user↔user edge without a privacy-sensitive
 * email join — left out of the v1 exclusion set.
 */

import Follow, { FollowType } from '../../models/Follow';
import Block from '../../models/Block';
import Session from '../../models/Session';

/** Why two users were judged related (for audit + a machine-readable reason). */
export type ExclusionReason = 'self' | 'graph_neighbor' | 'shared_device' | 'shared_ip';

export type ExclusionResult =
  | { excluded: false }
  | { excluded: true; reason: ExclusionReason };

/**
 * The set of a user's DIRECT graph neighbours (as id strings): everyone they
 * follow, everyone who follows them, and either side of a block edge.
 */
async function directNeighbors(userId: string): Promise<Set<string>> {
  const [followsOut, followsIn, blocksOut, blocksIn] = await Promise.all([
    Follow.find({ followerUserId: userId, followType: FollowType.USER }).select('followedId').lean(),
    Follow.find({ followType: FollowType.USER, followedId: userId }).select('followerUserId').lean(),
    Block.find({ userId }).select('blockedId').lean(),
    Block.find({ blockedId: userId }).select('userId').lean(),
  ]);

  const set = new Set<string>();
  for (const f of followsOut) set.add(String(f.followedId));
  for (const f of followsIn) set.add(String(f.followerUserId));
  for (const b of blocksOut) set.add(String(b.blockedId));
  for (const b of blocksIn) set.add(String(b.userId));
  return set;
}

/**
 * True when `a` and `b` are within `hops` social-graph hops. `hops === 1` is a
 * direct edge; `hops >= 2` additionally treats a shared direct neighbour as
 * related.
 */
export async function areGraphRelated(a: string, b: string, hops = 1): Promise<boolean> {
  if (a === b) {
    return true;
  }
  const neighborsA = await directNeighbors(a);
  if (neighborsA.has(b)) {
    return true;
  }
  if (hops >= 2) {
    const neighborsB = await directNeighbors(b);
    if (neighborsB.has(a)) {
      return true;
    }
    for (const x of neighborsA) {
      if (neighborsB.has(x)) {
        return true;
      }
    }
  }
  return false;
}

/** Collect a user's active-session device + IP fingerprints. Exported so the
 * Fase 3 sybil heuristics can cluster accounts by shared fingerprints without
 * re-implementing the (deviceId / fingerprint / IP) extraction. */
export async function sessionFingerprints(
  userId: string,
): Promise<{ devices: Set<string>; ips: Set<string> }> {
  const sessions = await Session.find({ userId, isActive: true })
    .select('deviceId deviceInfo.ipAddress deviceInfo.fingerprint')
    .lean();
  const devices = new Set<string>();
  const ips = new Set<string>();
  for (const session of sessions) {
    const record = session as { deviceId?: string; deviceInfo?: { ipAddress?: string; fingerprint?: string } };
    if (record.deviceId) devices.add(record.deviceId);
    if (record.deviceInfo?.fingerprint) devices.add(record.deviceInfo.fingerprint);
    if (record.deviceInfo?.ipAddress) ips.add(record.deviceInfo.ipAddress);
  }
  return { devices, ips };
}

/** True (with kind) when `a` and `b` share an active device fingerprint or IP. */
export async function shareDeviceOrIp(
  a: string,
  b: string,
): Promise<{ shared: false } | { shared: true; kind: 'device' | 'ip' }> {
  const [fa, fb] = await Promise.all([sessionFingerprints(a), sessionFingerprints(b)]);
  for (const device of fa.devices) {
    if (fb.devices.has(device)) {
      return { shared: true, kind: 'device' };
    }
  }
  for (const ip of fa.ips) {
    if (fb.ips.has(ip)) {
      return { shared: true, kind: 'ip' };
    }
  }
  return { shared: false };
}

/**
 * The shared sock-puppet test: `a` and `b` are excluded from attesting/judging
 * each other when they are the same account, within `hops` graph hops, or share
 * an active device/IP. Returns the FIRST matching reason.
 */
export async function isSockPuppetRelation(
  a: string,
  b: string,
  opts: { hops?: number } = {},
): Promise<ExclusionResult> {
  if (a === b) {
    return { excluded: true, reason: 'self' };
  }
  if (await areGraphRelated(a, b, opts.hops ?? 1)) {
    return { excluded: true, reason: 'graph_neighbor' };
  }
  const device = await shareDeviceOrIp(a, b);
  if (device.shared) {
    return { excluded: true, reason: device.kind === 'ip' ? 'shared_ip' : 'shared_device' };
  }
  return { excluded: false };
}
