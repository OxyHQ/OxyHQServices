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
});
