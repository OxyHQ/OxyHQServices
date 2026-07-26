/**
 * Transparency-log tests — leaf hashing, the Merkle tree, inclusion proofs, and
 * the co-signable checkpoint.
 *
 * These lock the properties a third party depends on when auditing Oxy without
 * trusting it: a root recomputable from a snapshot in any order, an inclusion
 * proof verifiable from ONLY the verifier's own leaf (never the full leaf set),
 * and a checkpoint whose signing bytes are identical for every independent
 * co-signer (Oxy plus witness nodes).
 */

import { ec as EC } from 'elliptic';
import {
  sha256,
  transparencyLeafHash,
  buildTransparencyTree,
  buildTransparencyTreeFromHeads,
  inclusionProof,
  verifyInclusionProof,
  EMPTY_TRANSPARENCY_ROOT,
  checkpointSigningInput,
  checkpointHash,
  signCheckpoint,
  verifyCheckpointSignature,
  type TransparencyHeadEntry,
  type TransparencyCheckpointFields,
} from '../index';

const ec = new EC('secp256k1');

const HEAD_A: TransparencyHeadEntry = {
  subjectDid: 'did:web:oxy.so:u:aaa',
  seq: 4,
  headRecordId: 'a'.repeat(64),
};
const HEAD_B: TransparencyHeadEntry = {
  subjectDid: 'did:web:oxy.so:u:bbb',
  seq: 0,
  headRecordId: 'b'.repeat(64),
};
const HEAD_C: TransparencyHeadEntry = {
  subjectDid: 'did:web:oxy.so:u:ccc',
  seq: 17,
  headRecordId: 'c'.repeat(64),
};

/** `n` distinct head entries, deterministic. */
function heads(n: number): TransparencyHeadEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    subjectDid: `did:web:oxy.so:u:${String(i).padStart(3, '0')}`,
    seq: i,
    headRecordId: String(i).padStart(64, '0'),
  }));
}

describe('transparencyLeafHash', () => {
  it('is deterministic for the same head', async () => {
    expect(await transparencyLeafHash(HEAD_A)).toBe(await transparencyLeafHash(HEAD_A));
  });

  it('changes when seq advances', async () => {
    const before = await transparencyLeafHash(HEAD_A);
    const after = await transparencyLeafHash({ ...HEAD_A, seq: HEAD_A.seq + 1 });
    expect(after).not.toBe(before);
  });

  it('changes when the head record id changes', async () => {
    const tampered = await transparencyLeafHash({ ...HEAD_A, headRecordId: 'd'.repeat(64) });
    expect(tampered).not.toBe(await transparencyLeafHash(HEAD_A));
  });

  it('changes when the subject changes', async () => {
    const other = await transparencyLeafHash({ ...HEAD_A, subjectDid: HEAD_B.subjectDid });
    expect(other).not.toBe(await transparencyLeafHash(HEAD_A));
  });

  it('is domain-separated, so it is never a bare hash of the concatenated fields', async () => {
    const bare = await sha256(`${HEAD_A.subjectDid}${HEAD_A.seq}${HEAD_A.headRecordId}`);
    expect(await transparencyLeafHash(HEAD_A)).not.toBe(bare);
  });
});

describe('buildTransparencyTree', () => {
  it('gives the empty tree a fixed, domain-separated root', async () => {
    const tree = await buildTransparencyTree([]);
    expect(tree.treeSize).toBe(0);
    expect(tree.root).toBe(EMPTY_TRANSPARENCY_ROOT);
  });

  it('pins the empty root to the hash of its domain string', async () => {
    // The constant is hard-coded (the hash is async), so this pins it against
    // an accidental edit: a changed empty root changes every empty checkpoint.
    expect(EMPTY_TRANSPARENCY_ROOT).toBe(await sha256('oxy.transparency.empty.v1'));
  });

  it('uses the leaf itself as the root of a single-leaf tree', async () => {
    const leaf = await transparencyLeafHash(HEAD_A);
    const tree = await buildTransparencyTree([leaf]);
    expect(tree.root).toBe(leaf);
    expect(tree.treeSize).toBe(1);
  });

  it('hashes a two-leaf tree as one interior node over the ordered pair', async () => {
    const l0 = await transparencyLeafHash(HEAD_A);
    const l1 = await transparencyLeafHash(HEAD_B);
    const tree = await buildTransparencyTree([l0, l1]);
    expect(tree.root).toBe(await sha256(`oxy.transparency.node.v1:${l0}${l1}`));
  });

  it('is order-sensitive at the leaf level (swapping two leaves changes the root)', async () => {
    const l0 = await transparencyLeafHash(HEAD_A);
    const l1 = await transparencyLeafHash(HEAD_B);
    const forward = await buildTransparencyTree([l0, l1]);
    const reversed = await buildTransparencyTree([l1, l0]);
    expect(reversed.root).not.toBe(forward.root);
  });

  it('splits an odd tree so the left subtree is the largest power of two below the size', async () => {
    const l = await Promise.all([HEAD_A, HEAD_B, HEAD_C].map(transparencyLeafHash));
    const left = await sha256(`oxy.transparency.node.v1:${l[0]}${l[1]}`);
    const tree = await buildTransparencyTree(l);
    expect(tree.root).toBe(await sha256(`oxy.transparency.node.v1:${left}${l[2]}`));
  });
});

describe('buildTransparencyTreeFromHeads', () => {
  it('sorts by subject did, so the root does not depend on the input order', async () => {
    const sorted = await buildTransparencyTreeFromHeads([HEAD_A, HEAD_B, HEAD_C]);
    const shuffled = await buildTransparencyTreeFromHeads([HEAD_C, HEAD_A, HEAD_B]);
    expect(shuffled.root).toBe(sorted.root);
    expect(shuffled.treeSize).toBe(3);
  });

  it('reports the leaf index of each subject so a proof can be served', async () => {
    const tree = await buildTransparencyTreeFromHeads([HEAD_C, HEAD_A, HEAD_B]);
    expect(tree.indexBySubject[HEAD_A.subjectDid]).toBe(0);
    expect(tree.indexBySubject[HEAD_B.subjectDid]).toBe(1);
    expect(tree.indexBySubject[HEAD_C.subjectDid]).toBe(2);
  });

  it('rejects a duplicate subject rather than silently committing to one of them', async () => {
    await expect(buildTransparencyTreeFromHeads([HEAD_A, HEAD_A])).rejects.toThrow(/duplicate/i);
  });
});

describe('verifyInclusionProof', () => {
  it('verifies every leaf of every tree size from 1 to 9', async () => {
    for (let size = 1; size <= 9; size++) {
      const entries = heads(size);
      const tree = await buildTransparencyTreeFromHeads(entries);
      for (let index = 0; index < size; index++) {
        const leaf = await transparencyLeafHash(entries[index]);
        const proof = await inclusionProof(tree.leaves, index);
        await expect(
          verifyInclusionProof({ leaf, index, treeSize: size, proof, root: tree.root }),
        ).resolves.toBe(true);
      }
    }
  });

  it('verifies from the leaf alone, without the rest of the leaf set', async () => {
    const entries = heads(7);
    const tree = await buildTransparencyTreeFromHeads(entries);
    const proof = await inclusionProof(tree.leaves, 5);
    const leaf = await transparencyLeafHash(entries[5]);
    // Only the verifier's own leaf, its index, the tree size, the path and the
    // signed root — the full leaf set is never needed.
    await expect(
      verifyInclusionProof({ leaf, index: 5, treeSize: 7, proof, root: tree.root }),
    ).resolves.toBe(true);
  });

  it('fails when the head record id was tampered with after the checkpoint', async () => {
    const entries = heads(5);
    const tree = await buildTransparencyTreeFromHeads(entries);
    const proof = await inclusionProof(tree.leaves, 2);
    const tamperedLeaf = await transparencyLeafHash({ ...entries[2], headRecordId: 'f'.repeat(64) });
    await expect(
      verifyInclusionProof({ leaf: tamperedLeaf, index: 2, treeSize: 5, proof, root: tree.root }),
    ).resolves.toBe(false);
  });

  it('fails when a chain was rolled back to an earlier seq', async () => {
    const entries = heads(5);
    const tree = await buildTransparencyTreeFromHeads(entries);
    const proof = await inclusionProof(tree.leaves, 3);
    const rolledBack = await transparencyLeafHash({ ...entries[3], seq: entries[3].seq - 1 });
    await expect(
      verifyInclusionProof({ leaf: rolledBack, index: 3, treeSize: 5, proof, root: tree.root }),
    ).resolves.toBe(false);
  });

  it('fails when the proof is replayed at a different index', async () => {
    const entries = heads(6);
    const tree = await buildTransparencyTreeFromHeads(entries);
    const proof = await inclusionProof(tree.leaves, 1);
    const leaf = await transparencyLeafHash(entries[1]);
    await expect(
      verifyInclusionProof({ leaf, index: 2, treeSize: 6, proof, root: tree.root }),
    ).resolves.toBe(false);
  });

  it('fails against the root of a different checkpoint', async () => {
    const entries = heads(4);
    const tree = await buildTransparencyTreeFromHeads(entries);
    const otherTree = await buildTransparencyTreeFromHeads(heads(5));
    const proof = await inclusionProof(tree.leaves, 0);
    const leaf = await transparencyLeafHash(entries[0]);
    await expect(
      verifyInclusionProof({ leaf, index: 0, treeSize: 4, proof, root: otherTree.root }),
    ).resolves.toBe(false);
  });

  it('fails when the proof path is truncated', async () => {
    const entries = heads(8);
    const tree = await buildTransparencyTreeFromHeads(entries);
    const proof = await inclusionProof(tree.leaves, 0);
    await expect(
      verifyInclusionProof({
        leaf: await transparencyLeafHash(entries[0]),
        index: 0,
        treeSize: 8,
        proof: proof.slice(0, -1),
        root: tree.root,
      }),
    ).resolves.toBe(false);
  });

  it('rejects an index outside the tree instead of verifying', async () => {
    const entries = heads(3);
    const tree = await buildTransparencyTreeFromHeads(entries);
    await expect(inclusionProof(tree.leaves, 3)).rejects.toThrow(/index/i);
  });
});

describe('checkpoint signing', () => {
  const fields: TransparencyCheckpointFields = {
    index: 42,
    periodEnd: 1_800_000_000_000,
    treeSize: 3,
    root: 'e'.repeat(64),
    prevCheckpointHash: '9'.repeat(64),
  };

  it('produces stable, domain-separated signing bytes', async () => {
    expect(checkpointSigningInput(fields)).toBe(checkpointSigningInput({ ...fields }));
    expect(checkpointSigningInput(fields)).toContain('oxy.transparency.checkpoint.v1:');
  });

  it('does not depend on the key order of the fields object', () => {
    const reordered: TransparencyCheckpointFields = {
      prevCheckpointHash: fields.prevCheckpointHash,
      root: fields.root,
      treeSize: fields.treeSize,
      periodEnd: fields.periodEnd,
      index: fields.index,
    };
    expect(checkpointSigningInput(reordered)).toBe(checkpointSigningInput(fields));
  });

  it('changes the hash when the root changes', async () => {
    const other = await checkpointHash({ ...fields, root: 'f'.repeat(64) });
    expect(other).not.toBe(await checkpointHash(fields));
  });

  it('changes the hash when the previous checkpoint link changes', async () => {
    const other = await checkpointHash({ ...fields, prevCheckpointHash: '8'.repeat(64) });
    expect(other).not.toBe(await checkpointHash(fields));
  });

  it('verifies a signature made by the signer', async () => {
    const key = ec.genKeyPair();
    const signature = await signCheckpoint(fields, key.getPrivate('hex'));
    expect(signature.alg).toBe('ES256K-DER-SHA256');
    expect(signature.publicKey).toBe(key.getPublic('hex'));
    await expect(verifyCheckpointSignature(fields, signature)).resolves.toBe(true);
  });

  it('rejects a signature once any signed field is altered', async () => {
    const key = ec.genKeyPair();
    const signature = await signCheckpoint(fields, key.getPrivate('hex'));
    await expect(
      verifyCheckpointSignature({ ...fields, treeSize: fields.treeSize + 1 }, signature),
    ).resolves.toBe(false);
  });

  it('lets independent co-signers sign the identical bytes, so witnesses need no coordination', async () => {
    const oxy = ec.genKeyPair();
    const witnessOne = ec.genKeyPair();
    const witnessTwo = ec.genKeyPair();
    const signatures = await Promise.all(
      [oxy, witnessOne, witnessTwo].map((k) => signCheckpoint(fields, k.getPrivate('hex'))),
    );
    for (const signature of signatures) {
      await expect(verifyCheckpointSignature(fields, signature)).resolves.toBe(true);
    }
    // Distinct signers, distinct signatures, one set of signed bytes.
    expect(new Set(signatures.map((s) => s.signature)).size).toBe(3);
  });

  it('does not accept a signature from one checkpoint on the next one', async () => {
    const key = ec.genKeyPair();
    const signature = await signCheckpoint(fields, key.getPrivate('hex'));
    const next: TransparencyCheckpointFields = {
      ...fields,
      index: fields.index + 1,
      prevCheckpointHash: await checkpointHash(fields),
    };
    await expect(verifyCheckpointSignature(next, signature)).resolves.toBe(false);
  });
});
