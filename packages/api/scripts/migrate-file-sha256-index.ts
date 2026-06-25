import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { File } from '../src/models/File';

dotenv.config();

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(uri);
  const collection = File.collection;

  const indexes = await collection.indexes();
  const legacyShaIndex = indexes.find((index) =>
    index.name === 'sha256_1' &&
    JSON.stringify(index.key) === JSON.stringify({ sha256: 1 }) &&
    !index.partialFilterExpression
  );

  if (legacyShaIndex) {
    await collection.dropIndex(legacyShaIndex.name);
    console.log(`Dropped legacy global sha256 index: ${legacyShaIndex.name}`);
  } else {
    console.log('Legacy global sha256 index not found; skipping drop.');
  }

  await collection.createIndex(
    { sha256: 1 },
    {
      unique: true,
      partialFilterExpression: { $or: [{ status: 'active' }, { status: 'trash' }] },
      name: 'sha256_not_deleted_unique',
    },
  );
  console.log('Ensured partial unique sha256_not_deleted_unique index for non-deleted files.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
