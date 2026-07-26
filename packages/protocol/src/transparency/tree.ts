/**
 * Transparency Merkle tree — leaf hashing, root computation, and inclusion
 * proofs over a snapshot of chain heads.
 *
 * ## What this is for
 *
 * A per-subject hash chain proves nobody edited a record. It does NOT prove the
 * SERVER didn't serve two different histories to two parties (equivocation), or
 * quietly drop a record. That gap is closed by committing to every subject's
 * chain head at once, publishing the commitment, and letting anyone verify that
 * their own head is inside it — which is exactly what this tree does. The
 * commitment (the root) is what gets signed into a checkpoint (`./checkpoint`)
 * and anchored on a public chain.
 *
 * ## Shape
 *
 * The tree follows RFC 6962 (Certificate Transparency) so the algorithms are
 * standard and independently reimplementable: leaves and interior nodes are
 * hashed under DISTINCT domain prefixes (a leaf hash can never be reinterpreted
 * as an interior node), an odd level splits so the LEFT subtree is the largest
 * power of two below the size, and a single-leaf tree's root is the leaf itself.
 *
 * Crucially, {@link verifyInclusionProof} needs only the verifier's OWN leaf,
 * its index, the tree size, the audit path, and the signed root — never the
 * other leaves. So a device or node can audit its own history against a
 * published checkpoint without downloading anyone else's data.
 *
 * The leaf order is fixed by {@link buildTransparencyTreeFromHeads}: ascending
 * by `subjectDid` in UTF-16 code-unit order. Order is part of the commitment, so
 * every implementation MUST sort identically or the roots diverge.
 */

import { sha256 } from '../envelope/recordId';
import { canonicalize } from '../envelope/canonicalJson';

/** Domain prefix for a leaf hash. Distinct from {@link NODE_PREFIX}. */
const LEAF_PREFIX = 'oxy.transparency.leaf.v1:';
/** Domain prefix for an interior node hash. Distinct from {@link LEAF_PREFIX}. */
const NODE_PREFIX = 'oxy.transparency.node.v1:';
/** The pre-image of {@link EMPTY_TRANSPARENCY_ROOT}. */
const EMPTY_PREIMAGE = 'oxy.transparency.empty.v1';

/**
 * The root of a tree with zero leaves: `sha256("oxy.transparency.empty.v1")`.
 *
 * Hard-coded because hashing is async and this is needed as a value; a Jest
 * regression test pins it against the live hash of {@link EMPTY_PREIMAGE}.
 */
export const EMPTY_TRANSPARENCY_ROOT =
  '315338df4bc34de7d057b583a082268016888323c79c0376586406a64f441b1e';

/**
 * One subject's committed chain position: the head of their signed-record chain
 * at the moment the snapshot was taken. Mirrors the `RepoHead` row an app keeps.
 */
export interface TransparencyHeadEntry {
  /** The chain's subject DID (`did:web:<domain>:u:<userId>`). */
  subjectDid: string;
  /** The `seq` of the head record. */
  seq: number;
  /** The `recordId` (content address) of the head record. */
  headRecordId: string;
}

/** A built tree: its commitment plus the ordered leaf hashes proofs are cut from. */
export interface TransparencyTree {
  root: string;
  treeSize: number;
  /** Leaf hashes in committed order. */
  leaves: string[];
}

/** A tree built from head entries, with the leaf index of every subject. */
export interface TransparencyTreeFromHeads extends TransparencyTree {
  /** `subjectDid` → leaf index, so a proof can be served by subject. */
  indexBySubject: Record<string, number>;
}

/** Arguments for {@link verifyInclusionProof}. */
export interface InclusionProofCheck {
  /** The verifier's own leaf hash ({@link transparencyLeafHash}). */
  leaf: string;
  /** The leaf's index in the committed order. */
  index: number;
  /** The `treeSize` the checkpoint committed to. */
  treeSize: number;
  /** The audit path, leaf-adjacent sibling first. */
  proof: string[];
  /** The root the checkpoint committed to. */
  root: string;
}

/**
 * Hash one subject's head into a leaf.
 *
 * The pre-image is the canonical JSON of the three committed fields under the
 * leaf domain prefix — so a DID containing a delimiter-like character cannot
 * forge another subject's leaf (JSON escaping makes the encoding unambiguous),
 * and a leaf can never collide with an interior node.
 */
export async function transparencyLeafHash(entry: TransparencyHeadEntry): Promise<string> {
  const preimage = canonicalize({
    subjectDid: entry.subjectDid,
    seq: entry.seq,
    headRecordId: entry.headRecordId,
  });
  return sha256(`${LEAF_PREFIX}${preimage}`);
}

/** Hash an interior node over its ordered children. */
async function nodeHash(left: string, right: string): Promise<string> {
  return sha256(`${NODE_PREFIX}${left}${right}`);
}

/** The largest power of two strictly below `n` (RFC 6962's split point; `n > 1`). */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) {
    k *= 2;
  }
  return k;
}

/** The Merkle tree hash of a leaf-hash slice (RFC 6962 MTH). */
async function merkleTreeHash(leaves: string[]): Promise<string> {
  if (leaves.length === 0) {
    return EMPTY_TRANSPARENCY_ROOT;
  }
  if (leaves.length === 1) {
    return leaves[0];
  }
  const k = splitPoint(leaves.length);
  const [left, right] = await Promise.all([
    merkleTreeHash(leaves.slice(0, k)),
    merkleTreeHash(leaves.slice(k)),
  ]);
  return nodeHash(left, right);
}

/**
 * Build a tree over already-hashed leaves, in the given order.
 *
 * The order IS part of the commitment — prefer
 * {@link buildTransparencyTreeFromHeads}, which owns the canonical ordering.
 */
export async function buildTransparencyTree(leaves: string[]): Promise<TransparencyTree> {
  return { root: await merkleTreeHash(leaves), treeSize: leaves.length, leaves: [...leaves] };
}

/**
 * Build the canonical tree for a snapshot of chain heads.
 *
 * Sorts ascending by `subjectDid` in UTF-16 code-unit order — NEVER
 * `localeCompare`, whose order is locale-dependent and would make two
 * verifiers compute different roots from identical data.
 *
 * Throws on a duplicate `subjectDid`: a snapshot must commit to exactly one head
 * per subject, and silently keeping one of two would hide the other's history.
 */
export async function buildTransparencyTreeFromHeads(
  entries: TransparencyHeadEntry[],
): Promise<TransparencyTreeFromHeads> {
  const ordered = [...entries].sort((a, b) =>
    a.subjectDid < b.subjectDid ? -1 : a.subjectDid > b.subjectDid ? 1 : 0,
  );

  const indexBySubject: Record<string, number> = {};
  ordered.forEach((entry, index) => {
    if (indexBySubject[entry.subjectDid] !== undefined) {
      throw new Error(`Duplicate subject in transparency snapshot: ${entry.subjectDid}`);
    }
    indexBySubject[entry.subjectDid] = index;
  });

  const leaves = await Promise.all(ordered.map(transparencyLeafHash));
  return { ...(await buildTransparencyTree(leaves)), indexBySubject };
}

/**
 * The audit path proving `index` is committed in a tree over `leaves`
 * (RFC 6962 PATH): each step is the sibling subtree hash, leaf-adjacent first.
 */
export async function inclusionProof(leaves: string[], index: number): Promise<string[]> {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new Error(`Leaf index ${index} is outside a tree of ${leaves.length} leaves`);
  }
  if (leaves.length === 1) {
    return [];
  }
  const k = splitPoint(leaves.length);
  if (index < k) {
    const path = await inclusionProof(leaves.slice(0, k), index);
    return [...path, await merkleTreeHash(leaves.slice(k))];
  }
  const path = await inclusionProof(leaves.slice(k), index - k);
  return [...path, await merkleTreeHash(leaves.slice(0, k))];
}

/**
 * Verify an audit path against a committed root (RFC 6962 §2.1.1).
 *
 * Recomputes the root from the leaf upward using only the path, so the verifier
 * never needs another subject's data. Returns `false` for every failure mode —
 * tampered leaf, replayed index, truncated path, foreign root — rather than
 * throwing, so callers treat auditing as a boolean.
 */
export async function verifyInclusionProof(check: InclusionProofCheck): Promise<boolean> {
  const { leaf, index, treeSize, proof, root } = check;
  if (!Number.isInteger(index) || !Number.isInteger(treeSize)) {
    return false;
  }
  if (index < 0 || treeSize <= 0 || index >= treeSize) {
    return false;
  }

  let fn = index;
  let sn = treeSize - 1;
  let computed = leaf;

  for (const sibling of proof) {
    if (sn === 0) {
      // The path claims more levels than the tree has.
      return false;
    }
    if (fn % 2 === 1 || fn === sn) {
      computed = await nodeHash(sibling, computed);
      while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else {
      computed = await nodeHash(computed, sibling);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }

  // `sn > 0` means the path was truncated before reaching the root.
  return sn === 0 && computed === root;
}
