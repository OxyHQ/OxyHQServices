import { deviceRoomFor } from '../socket';

describe('deviceRoomFor', () => {
  it('returns device:<deviceId> when present', () => {
    expect(deviceRoomFor({ deviceId: 'd1' })).toBe('device:d1');
  });
  it('returns null when deviceId is absent', () => {
    expect(deviceRoomFor({})).toBeNull();
  });
});
