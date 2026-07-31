// The global jest.setup.cjs mocks `mongoose` wholesale; the real Subscription
// schema — the index declarations under test — only builds against the actual
// module, so restore it for this suite.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import Subscription from '../Subscription';

describe('Subscription indexes', () => {
  it('declares no TTL index: a lapsed subscription is expired, never deleted', () => {
    const ttlIndexes = Subscription.schema
      .indexes()
      .filter(([, options]) => options?.expireAfterSeconds !== undefined);

    // A TTL index DELETES the document. One on `endDate` destroyed every
    // subscription row the moment its period ended — no history, no reachable
    // `expired` status, and auto-renewing rows deleted instead of renewed.
    expect(ttlIndexes).toEqual([]);
  });

  it('indexes status + endDate for the in-force lookup and the lifecycle sweep', () => {
    const indexes = Subscription.schema.indexes();

    expect(indexes).toContainEqual([{ status: 1, endDate: 1 }, expect.any(Object)]);
    expect(indexes).toContainEqual([
      { userId: 1, status: 1, endDate: -1 },
      expect.any(Object),
    ]);
  });
});
