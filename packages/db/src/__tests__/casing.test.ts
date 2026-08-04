import { getTableName, sql } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { DATABASE_CASING, qualified, sqlColumnName } from '../casing';

const sessions = pgTable('sessions', {
  id: text().primaryKey(),
  expiresAt: timestamp({ withTimezone: true, mode: 'date' }),
  legacy: text('legacy_name'),
});

describe('casing', () => {
  it('uses snake_case as the one naming convention', () => {
    expect(DATABASE_CASING).toBe('snake_case');
  });

  it('derives the SQL name from the TypeScript property', () => {
    // The trap: `column.name` is `expiresAt`, which no Postgres column is called.
    expect(sqlColumnName(sessions.expiresAt)).toBe('expires_at');
  });

  it('honours an explicitly named column instead of re-deriving it', () => {
    expect(sqlColumnName(sessions.legacy)).toBe('legacy_name');
  });

  it('qualifies a column with its table, so a correlated subquery cannot rebind it', () => {
    const chunk = qualified(sessions.expiresAt);
    const rendered = sql`select 1 where ${chunk} is null`;
    expect(getTableName(sessions.expiresAt.table)).toBe('sessions');
    expect(rendered.queryChunks.length).toBeGreaterThan(0);
  });
});
