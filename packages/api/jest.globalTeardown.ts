/**
 * Jest global teardown — Postgres.
 *
 * Drops the throwaway database `jest.globalSetup.ts` created. Global setup and
 * teardown share a process, so `DATABASE_URL` still holds the throwaway URL
 * setup published; `dropTestDatabase` refuses any name that is not one of its
 * own, so a stray value here cannot destroy a real database.
 */

import { dropTestDatabase } from './src/db/testDatabase';

export default async function globalTeardown(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  await dropTestDatabase(url);
}
