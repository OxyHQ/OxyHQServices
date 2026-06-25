import { File } from '../File';

describe('File indexes', () => {
  it('uses a partial unique sha256 index so deleted tombstones do not block new uploads', () => {
    const indexes = File.schema.indexes();

    expect(indexes).toContainEqual([
      { sha256: 1 },
      expect.objectContaining({
        unique: true,
        name: 'sha256_not_deleted_unique',
        partialFilterExpression: { $or: [{ status: 'active' }, { status: 'trash' }] },
      }),
    ]);

    expect(indexes).not.toContainEqual([
      { sha256: 1 },
      expect.objectContaining({ unique: true, partialFilterExpression: undefined }),
    ]);
  });
});
