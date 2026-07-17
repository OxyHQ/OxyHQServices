import { normalizeActorUsername } from '../urls';

describe('normalizeActorUsername', () => {
  it('trims and lowercases mixed-case usernames', () => {
    expect(normalizeActorUsername('  Alice  ')).toBe('alice');
  });
});
