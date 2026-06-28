/**
 * NodeStore unit tests — append/continuity, log cursor + cap, head, record
 * materialization, and content-addressed blob storage.
 */

import { NodeStore, BlobHashMismatchError } from '../nodeStore';
import { createHash } from 'node:crypto';
import { buildSignedEnvelope, generateTestKeyPair, recordIdOf, type TestKeyPair } from '../../__tests__/helpers/signEnvelope';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';

describe('NodeStore', () => {
  let store: NodeStore;
  let owner: TestKeyPair;

  beforeEach(() => {
    store = new NodeStore(':memory:');
    owner = generateTestKeyPair();
  });

  afterEach(() => {
    store.close();
  });

  /** Append the genesis record and return [envelope, recordId]. */
  async function appendGenesis(over: Partial<Parameters<typeof buildSignedEnvelope>[0]> = {}): Promise<{
    envelope: SignedRecordEnvelope;
    recordId: string;
  }> {
    const envelope = await buildSignedEnvelope({
      privateKey: owner.privateKey,
      publicKey: owner.publicKey,
      seq: 0,
      prev: null,
      ...over,
    });
    const recordId = await recordIdOf(envelope);
    const outcome = store.appendRecord(envelope, recordId);
    expect(outcome.ok).toBe(true);
    return { envelope, recordId };
  }

  it('appends a genesis record and advances the head', async () => {
    expect(store.getHead()).toBeNull();

    const { recordId } = await appendGenesis();

    const head = store.getHead();
    expect(head).toEqual({ seq: 0, headRecordId: recordId, recordCount: 1 });
  });

  it('appends a chain of records with correct prev/seq linkage', async () => {
    const { recordId: genesisId } = await appendGenesis();

    const second = await buildSignedEnvelope({
      privateKey: owner.privateKey,
      publicKey: owner.publicKey,
      seq: 1,
      prev: genesisId,
      record: { step: 2 },
    });
    const secondId = await recordIdOf(second);
    const outcome = store.appendRecord(second, secondId);

    expect(outcome).toEqual({ ok: true, recordId: secondId, seq: 1 });
    expect(store.getHead()).toEqual({ seq: 1, headRecordId: secondId, recordCount: 2 });
  });

  it('rejects a chain GAP (first record is not genesis)', async () => {
    const envelope = await buildSignedEnvelope({
      privateKey: owner.privateKey,
      publicKey: owner.publicKey,
      seq: 5,
      prev: null,
    });
    const recordId = await recordIdOf(envelope);

    expect(store.appendRecord(envelope, recordId)).toEqual({ ok: false, reason: 'chain_gap' });
    expect(store.getHead()).toBeNull();
  });

  it('rejects a chain FORK (prev does not match the head)', async () => {
    await appendGenesis();

    const fork = await buildSignedEnvelope({
      privateKey: owner.privateKey,
      publicKey: owner.publicKey,
      seq: 1,
      prev: 'f'.repeat(64),
    });
    const forkId = await recordIdOf(fork);

    expect(store.appendRecord(fork, forkId)).toEqual({ ok: false, reason: 'chain_fork' });
    expect(store.getHead()?.seq).toBe(0);
  });

  it('rejects a bad seq (does not extend the head by exactly one)', async () => {
    const { recordId: genesisId } = await appendGenesis();

    const skip = await buildSignedEnvelope({
      privateKey: owner.privateKey,
      publicKey: owner.publicKey,
      seq: 2,
      prev: genesisId,
    });
    const skipId = await recordIdOf(skip);

    expect(store.appendRecord(skip, skipId)).toEqual({ ok: false, reason: 'bad_seq' });
  });

  it('returns the ordered log from a cursor and caps the limit', async () => {
    let prev: string | null = null;
    const ids: string[] = [];
    for (let seq = 0; seq < 5; seq += 1) {
      const envelope = await buildSignedEnvelope({
        privateKey: owner.privateKey,
        publicKey: owner.publicKey,
        seq,
        prev,
        record: { seq },
      });
      const id = await recordIdOf(envelope);
      expect(store.appendRecord(envelope, id).ok).toBe(true);
      ids.push(id);
      prev = id;
    }

    const all = store.getLogSince(undefined, 100);
    expect(all.map((entry) => entry.seq)).toEqual([0, 1, 2, 3, 4]);

    const afterSeq1 = store.getLogSince(1, 100);
    expect(afterSeq1.map((entry) => entry.seq)).toEqual([2, 3, 4]);

    const afterRecordId = store.getLogSince(ids[2], 100);
    expect(afterRecordId.map((entry) => entry.seq)).toEqual([3, 4]);

    const capped = store.getLogSince(undefined, 2);
    expect(capped.map((entry) => entry.seq)).toEqual([0, 1]);

    expect(store.getLogSince('f'.repeat(64), 100)).toEqual([]);
  });

  it('materializes the latest version of a record key', async () => {
    const { recordId: v0 } = await appendGenesis({ collection: 'app.oxy.profile', rkey: 'self', record: { bio: 'v0' } });

    const v1 = await buildSignedEnvelope({
      privateKey: owner.privateKey,
      publicKey: owner.publicKey,
      seq: 1,
      prev: v0,
      collection: 'app.oxy.profile',
      rkey: 'self',
      record: { bio: 'v1' },
    });
    const v1Id = await recordIdOf(v1);
    expect(store.appendRecord(v1, v1Id).ok).toBe(true);

    const latest = store.getRecord('app.oxy.profile', 'self');
    expect(latest?.seq).toBe(1);
    expect(latest?.envelope.record).toEqual({ bio: 'v1' });
    expect(store.getRecord('app.oxy.profile', 'missing')).toBeNull();
  });

  it('stores and serves a content-addressed blob', () => {
    const bytes = Buffer.from('hello blob world');
    const hash = createHash('sha256').update(bytes).digest('hex');

    expect(store.getBlob(hash)).toBeNull();
    store.putBlob(hash, bytes);
    expect(store.getBlob(hash)?.equals(bytes)).toBe(true);

    // Idempotent re-pin is a no-op.
    expect(() => store.putBlob(hash, bytes)).not.toThrow();
  });

  it('rejects a blob whose bytes do not hash to the address', () => {
    const bytes = Buffer.from('the real bytes');
    const wrongHash = createHash('sha256').update(Buffer.from('different bytes')).digest('hex');

    expect(() => store.putBlob(wrongHash, bytes)).toThrow(BlobHashMismatchError);
    expect(store.getBlob(wrongHash)).toBeNull();
  });
});
