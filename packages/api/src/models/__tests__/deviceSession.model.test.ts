jest.mock('mongoose', () => jest.requireActual('mongoose'));
import mongoose from 'mongoose';
import DeviceSession from '../DeviceSession';

describe('DeviceSession model', () => {
  it('registers on the "devicesessions" collection', () => {
    expect(DeviceSession.collection.name).toBe('devicesessions');
  });

  it('defaults revision to 0 and activeAccountId to null', () => {
    const doc = new DeviceSession({ deviceId: 'd1' });
    expect(doc.revision).toBe(0);
    expect(doc.activeAccountId).toBeNull();
    expect(doc.accounts).toHaveLength(0);
  });

  it('requires deviceId', () => {
    const doc = new DeviceSession({});
    const err = doc.validateSync();
    expect(err?.errors?.deviceId).toBeDefined();
  });

  it('stores an account subdocument with authuser + sessionId', () => {
    const accountId = new mongoose.Types.ObjectId();
    const doc = new DeviceSession({ deviceId: 'd1', accounts: [{ accountId, sessionId: 's1', authuser: 0 }] });
    expect(doc.accounts[0].sessionId).toBe('s1');
    expect(doc.accounts[0].authuser).toBe(0);
    expect(doc.accounts[0].addedAt).toBeInstanceOf(Date);
  });

  it('leaves the phase-2c device-secret fields unset by default (sparse — legacy docs predate them)', () => {
    const doc = new DeviceSession({ deviceId: 'd1' });
    expect(doc.secretHash).toBeUndefined();
    expect(doc.prevSecretHash).toBeUndefined();
    expect(doc.prevSecretExpiresAt).toBeUndefined();
  });

  it('stores the device-secret fields when provided', () => {
    const expiresAt = new Date();
    const doc = new DeviceSession({ deviceId: 'd1', secretHash: 'h1', prevSecretHash: 'h0', prevSecretExpiresAt: expiresAt });
    expect(doc.secretHash).toBe('h1');
    expect(doc.prevSecretHash).toBe('h0');
    expect(doc.prevSecretExpiresAt).toBe(expiresAt);
  });

  it('declares a sparse-unique index on secretHash (mirrors cookieKeyHash)', () => {
    const indexes = DeviceSession.schema.indexes();
    const secretIndex = indexes.find(([keys]) => keys.secretHash === 1);
    expect(secretIndex).toBeDefined();
    expect(secretIndex?.[1]).toMatchObject({ unique: true, sparse: true });
  });

  it('does NOT declare an index on the transient prev-secret fields', () => {
    const indexes = DeviceSession.schema.indexes();
    expect(indexes.some(([keys]) => keys.prevSecretHash !== undefined)).toBe(false);
    expect(indexes.some(([keys]) => keys.prevSecretExpiresAt !== undefined)).toBe(false);
  });
});
