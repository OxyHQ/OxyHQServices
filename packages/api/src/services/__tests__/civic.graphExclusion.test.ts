/**
 * Graph-exclusion tests (civic / Fase 2 anti-sybil core).
 *
 * Asserts the shared sock-puppet test used by BOTH the real-life flow and the
 * jury selection: related users (follow/block edge, common neighbour at 2 hops,
 * shared device/IP) are EXCLUDED; unrelated users are not. The Follow/Block/
 * Session models are driven by a tiny in-memory graph fixture so the rules are
 * exercised deterministically.
 */

interface GraphEntry {
  follows: string[];
  followedBy: string[];
  blocks: string[];
  blockedBy: string[];
  devices: string[];
  /** Coarse client-supplied `deviceInfo.fingerprint` values (environment hash,
   * NOT device-unique — must never produce a `shared_device` verdict). */
  fingerprints: string[];
  ips: string[];
}

const graph: Record<string, Partial<GraphEntry>> = {};

function entry(id: string): GraphEntry {
  const e = graph[id] ?? {};
  return {
    follows: e.follows ?? [],
    followedBy: e.followedBy ?? [],
    blocks: e.blocks ?? [],
    blockedBy: e.blockedBy ?? [],
    devices: e.devices ?? [],
    fingerprints: e.fingerprints ?? [],
    ips: e.ips ?? [],
  };
}

function chain<T>(rows: T[]) {
  return { select: () => ({ lean: async () => rows }) };
}

jest.mock('../../models/Follow', () => ({
  __esModule: true,
  FollowType: { USER: 'user', HASHTAG: 'hashtag', TOPIC: 'topic' },
  default: {
    find: (q: Record<string, unknown>) => {
      if ('followerUserId' in q) {
        return chain(entry(String(q.followerUserId)).follows.map((id) => ({ followedId: id })));
      }
      return chain(entry(String(q.followedId)).followedBy.map((id) => ({ followerUserId: id })));
    },
  },
}));
jest.mock('../../models/Block', () => ({
  __esModule: true,
  default: {
    find: (q: Record<string, unknown>) => {
      if ('userId' in q) {
        return chain(entry(String(q.userId)).blocks.map((id) => ({ blockedId: id })));
      }
      return chain(entry(String(q.blockedId)).blockedBy.map((id) => ({ userId: id })));
    },
  },
}));
jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: {
    find: (q: Record<string, unknown>) => {
      const e = entry(String(q.userId));
      const rows = [
        ...e.devices.map((d, i) => ({ deviceId: d, deviceInfo: { fingerprint: e.fingerprints[i] } })),
        ...e.fingerprints.slice(e.devices.length).map((fp) => ({ deviceInfo: { fingerprint: fp } })),
        ...e.ips.map((ip) => ({ deviceInfo: { ipAddress: ip } })),
      ];
      return chain(rows);
    },
  },
}));

import { isSockPuppetRelation, areGraphRelated } from '../civic/graphExclusion';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const X = 'c'.repeat(24);

beforeEach(() => {
  for (const k of Object.keys(graph)) delete graph[k];
});

describe('isSockPuppetRelation', () => {
  it('excludes a user from themselves (self)', async () => {
    expect(await isSockPuppetRelation(A, A)).toEqual({ excluded: true, reason: 'self' });
  });

  it('excludes a direct follow edge (A follows B)', async () => {
    graph[A] = { follows: [B] };
    graph[B] = { followedBy: [A] };
    expect(await isSockPuppetRelation(A, B)).toEqual({ excluded: true, reason: 'graph_neighbor' });
  });

  it('excludes a block edge (B blocked A)', async () => {
    graph[A] = { blockedBy: [B] };
    graph[B] = { blocks: [A] };
    expect(await isSockPuppetRelation(A, B)).toEqual({ excluded: true, reason: 'graph_neighbor' });
  });

  it('excludes a shared deviceId (true multi-account on one install)', async () => {
    graph[A] = { devices: ['dev-1'] };
    graph[B] = { devices: ['dev-1'] };
    expect(await isSockPuppetRelation(A, B)).toEqual({ excluded: true, reason: 'shared_device' });
  });

  it('excludes a shared IP', async () => {
    graph[A] = { ips: ['1.2.3.4'] };
    graph[B] = { ips: ['1.2.3.4'] };
    expect(await isSockPuppetRelation(A, B)).toEqual({ excluded: true, reason: 'shared_ip' });
  });

  it('does NOT exclude two distinct installs that share only the coarse environment fingerprint', async () => {
    // Regression (prod incident): two DISTINCT physical phones — separate
    // per-install deviceIds, separate IPs — produced the IDENTICAL client
    // `deviceInfo.fingerprint` (environment hash of ua/platform/language/
    // timezone: no device-unique input on React Native). The fingerprint must
    // NOT yield a `shared_device` verdict.
    graph[A] = { devices: ['dev-a'], fingerprints: ['same-env-fp'], ips: ['9.9.9.9'] };
    graph[B] = { devices: ['dev-b'], fingerprints: ['same-env-fp'], ips: ['8.8.8.8'] };
    expect(await isSockPuppetRelation(A, B)).toEqual({ excluded: false });
  });

  it('still excludes a shared deviceId even when fingerprints differ', async () => {
    graph[A] = { devices: ['dev-1'], fingerprints: ['fp-a'] };
    graph[B] = { devices: ['dev-1'], fingerprints: ['fp-b'] };
    expect(await isSockPuppetRelation(A, B)).toEqual({ excluded: true, reason: 'shared_device' });
  });

  it('does NOT exclude unrelated users', async () => {
    graph[A] = { follows: [X], devices: ['dev-a'], ips: ['9.9.9.9'] };
    graph[B] = { follows: ['z'.repeat(24)], devices: ['dev-b'], ips: ['8.8.8.8'] };
    expect(await isSockPuppetRelation(A, B)).toEqual({ excluded: false });
  });
});

describe('areGraphRelated — hop radius', () => {
  it('treats a common neighbour as related at 2 hops but NOT at 1 hop', async () => {
    // A follows X; B follows X — A and B share neighbour X (no direct edge).
    graph[A] = { follows: [X] };
    graph[B] = { follows: [X] };
    graph[X] = { followedBy: [A, B] };

    expect(await areGraphRelated(A, B, 1)).toBe(false);
    expect(await areGraphRelated(A, B, 2)).toBe(true);
  });
});
