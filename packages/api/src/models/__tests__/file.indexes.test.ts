// The global jest.setup.cjs mocks `mongoose` wholesale; the real File schema —
// its indexes and `sha256` path options under test — only builds against the
// actual module, so restore it for this suite.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import { File } from '../File';

describe('File sha256 indexes', () => {
  it('keeps sha256 uniqueness scoped to live records so deleted tombstones do not block replacement uploads', () => {
    const indexes = File.schema.indexes();

    expect(indexes).toContainEqual([
      { sha256: 1 },
      expect.objectContaining({
        unique: true,
        name: 'sha256_live_unique',
        partialFilterExpression: { status: { $in: ['active', 'trash'] } },
      }),
    ]);

    const shaPath = File.schema.path('sha256') as { options: { unique?: boolean } };
    expect(shaPath.options.unique).toBeUndefined();
  });
});
