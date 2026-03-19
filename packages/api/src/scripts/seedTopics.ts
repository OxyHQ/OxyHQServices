/**
 * Idempotent seed script for category topics.
 *
 * Usage:
 *   npx ts-node src/scripts/seedTopics.ts
 *
 * Requires MONGODB_URI and NODE_ENV environment variables.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Topic, TopicType, TopicSource } from '../models/Topic.js';
import { getDbName } from '../config/db.js';

dotenv.config();

interface SeedEntry {
  name: string;
  displayName: string;
  translations: Record<string, { displayName: string }>;
}

const CATEGORIES: SeedEntry[] = [
  { name: 'animals', displayName: 'Animals', translations: { 'es-ES': { displayName: 'Animales' }, 'ca-ES': { displayName: 'Animals' } } },
  { name: 'art', displayName: 'Art', translations: { 'es-ES': { displayName: 'Arte' }, 'ca-ES': { displayName: 'Art' } } },
  { name: 'books', displayName: 'Books', translations: { 'es-ES': { displayName: 'Libros' }, 'ca-ES': { displayName: 'Llibres' } } },
  { name: 'comedy', displayName: 'Comedy', translations: { 'es-ES': { displayName: 'Comedia' }, 'ca-ES': { displayName: 'Comèdia' } } },
  { name: 'comics', displayName: 'Comics', translations: { 'es-ES': { displayName: 'Cómics' }, 'ca-ES': { displayName: 'Còmics' } } },
  { name: 'culture', displayName: 'Culture', translations: { 'es-ES': { displayName: 'Cultura' }, 'ca-ES': { displayName: 'Cultura' } } },
  { name: 'dev', displayName: 'Software Dev', translations: { 'es-ES': { displayName: 'Desarrollo' }, 'ca-ES': { displayName: 'Desenvolupament' } } },
  { name: 'education', displayName: 'Education', translations: { 'es-ES': { displayName: 'Educación' }, 'ca-ES': { displayName: 'Educació' } } },
  { name: 'finance', displayName: 'Finance', translations: { 'es-ES': { displayName: 'Finanzas' }, 'ca-ES': { displayName: 'Finances' } } },
  { name: 'food', displayName: 'Food', translations: { 'es-ES': { displayName: 'Comida' }, 'ca-ES': { displayName: 'Menjar' } } },
  { name: 'gaming', displayName: 'Video Games', translations: { 'es-ES': { displayName: 'Videojuegos' }, 'ca-ES': { displayName: 'Videojocs' } } },
  { name: 'journalism', displayName: 'Journalism', translations: { 'es-ES': { displayName: 'Periodismo' }, 'ca-ES': { displayName: 'Periodisme' } } },
  { name: 'movies', displayName: 'Movies', translations: { 'es-ES': { displayName: 'Películas' }, 'ca-ES': { displayName: 'Pel·lícules' } } },
  { name: 'music', displayName: 'Music', translations: { 'es-ES': { displayName: 'Música' }, 'ca-ES': { displayName: 'Música' } } },
  { name: 'nature', displayName: 'Nature', translations: { 'es-ES': { displayName: 'Naturaleza' }, 'ca-ES': { displayName: 'Natura' } } },
  { name: 'news', displayName: 'News', translations: { 'es-ES': { displayName: 'Noticias' }, 'ca-ES': { displayName: 'Notícies' } } },
  { name: 'pets', displayName: 'Pets', translations: { 'es-ES': { displayName: 'Mascotas' }, 'ca-ES': { displayName: 'Mascotes' } } },
  { name: 'photography', displayName: 'Photography', translations: { 'es-ES': { displayName: 'Fotografía' }, 'ca-ES': { displayName: 'Fotografia' } } },
  { name: 'politics', displayName: 'Politics', translations: { 'es-ES': { displayName: 'Política' }, 'ca-ES': { displayName: 'Política' } } },
  { name: 'science', displayName: 'Science', translations: { 'es-ES': { displayName: 'Ciencia' }, 'ca-ES': { displayName: 'Ciència' } } },
  { name: 'sports', displayName: 'Sports', translations: { 'es-ES': { displayName: 'Deportes' }, 'ca-ES': { displayName: 'Esports' } } },
  { name: 'tech', displayName: 'Tech', translations: { 'es-ES': { displayName: 'Tecnología' }, 'ca-ES': { displayName: 'Tecnologia' } } },
  { name: 'tv', displayName: 'TV', translations: { 'es-ES': { displayName: 'Televisión' }, 'ca-ES': { displayName: 'Televisió' } } },
  { name: 'writers', displayName: 'Writers', translations: { 'es-ES': { displayName: 'Escritores' }, 'ca-ES': { displayName: 'Escriptors' } } },
];

async function seed() {
  const dbName = getDbName();
  console.log(`Connecting to MongoDB (db: ${dbName})...`);

  await mongoose.connect(process.env.MONGODB_URI as string, {
    dbName,
    autoIndex: true,
  });
  console.log('Connected.');

  const ops = CATEGORIES.map((cat) => ({
    updateOne: {
      filter: { name: cat.name },
      update: {
        $setOnInsert: {
          name: cat.name,
          slug: cat.name, // category names are already valid slugs
          displayName: cat.displayName,
          type: TopicType.CATEGORY,
          source: TopicSource.SEED,
          description: '',
          aliases: [] as string[],
          isActive: true,
          translations: new Map(Object.entries(cat.translations)),
        },
      },
      upsert: true,
    },
  }));

  const result = await Topic.bulkWrite(ops as Parameters<typeof Topic.bulkWrite>[0]);
  console.log(
    `Seed complete: ${result.upsertedCount} inserted, ${result.matchedCount} already existed.`
  );

  await mongoose.disconnect();
  console.log('Disconnected.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
