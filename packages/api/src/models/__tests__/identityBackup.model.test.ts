// Opt OUT of the global mongoose mock so the REAL schema (indexes, required
// fields, types) is exercised without a live connection.
jest.mock('mongoose', () => jest.requireActual('mongoose'));
import mongoose from 'mongoose';
import IdentityBackup from '../IdentityBackup';

const validDoc = {
  userId: new mongoose.Types.ObjectId(),
  lookupIdHash: 'a'.repeat(64),
  publicKeyHint: '04abcdef01234567',
  ciphertext: 'deadbeef',
  nonce: '00'.repeat(24),
  algorithm: 'xchacha20poly1305',
  kdfInfo: 'oxy-backup-encryption-key',
  version: 1,
  createdAt: '2026-07-16T00:00:00.000Z',
};

describe('IdentityBackup model', () => {
  it('registers on the "identitybackups" collection', () => {
    expect(IdentityBackup.collection.name).toBe('identitybackups');
  });

  it('validates a complete document', () => {
    const doc = new IdentityBackup(validDoc);
    expect(doc.validateSync()).toBeUndefined();
    // createdAt is the client's verbatim ISO STRING (not a Date).
    expect(typeof doc.createdAt).toBe('string');
    expect(doc.createdAt).toBe('2026-07-16T00:00:00.000Z');
  });

  it.each([
    'userId',
    'lookupIdHash',
    'publicKeyHint',
    'ciphertext',
    'nonce',
    'algorithm',
    'kdfInfo',
    'version',
    'createdAt',
  ])('requires %s', (field) => {
    const partial: Record<string, unknown> = { ...validDoc };
    delete partial[field];
    const doc = new IdentityBackup(partial);
    const err = doc.validateSync();
    expect(err?.errors?.[field]).toBeDefined();
  });

  it('declares a unique index on userId (one backup per user)', () => {
    const indexes = IdentityBackup.schema.indexes();
    const userIndex = indexes.find(([keys]) => keys.userId === 1);
    expect(userIndex).toBeDefined();
    expect(userIndex?.[1]).toMatchObject({ unique: true });
  });

  it('declares a unique index on lookupIdHash (global locator)', () => {
    const indexes = IdentityBackup.schema.indexes();
    const lookupIndex = indexes.find(([keys]) => keys.lookupIdHash === 1);
    expect(lookupIndex).toBeDefined();
    expect(lookupIndex?.[1]).toMatchObject({ unique: true });
  });

  it('does NOT define a raw lookupId field (only the hash is ever stored)', () => {
    expect(IdentityBackup.schema.path('lookupId')).toBeUndefined();
    expect(IdentityBackup.schema.path('lookupIdHash')).toBeDefined();
  });
});
