import { isValidObjectId } from '../validation';

/**
 * Cutover regression guard. Two agents independently found guards written for
 * the 24-hex shape alone; one of them (`mediaPrivacyService`) failed OPEN, so a
 * post-migration account would have bypassed block enforcement entirely.
 */
describe('account id format accepts both live shapes', () => {
  it('accepts a pre-migration Mongo ObjectId', () => {
    expect(isValidObjectId('507f1f77bcf86cd799439011')).toBe(true);
  });

  it('accepts a post-cutover uuid v7', () => {
    expect(isValidObjectId('019fb834-d8a6-73fc-9073-da304c940f28')).toBe(true);
  });

  it('rejects a value that is neither', () => {
    expect(isValidObjectId('__federation__')).toBe(false);
    expect(isValidObjectId('')).toBe(false);
    expect(isValidObjectId('not-an-id')).toBe(false);
  });

  it('no longer accepts any 12-character string, which mongoose did and no caller wanted', () => {
    expect(isValidObjectId('abcdefghijkl')).toBe(false);
  });
});
