/**
 * NodeStore — the node's durable, append-only signed-record log and blob store,
 * backed by `better-sqlite3` (synchronous, single-file, on-disk).
 *
 * Responsibilities:
 *  - Append v2 signed-record envelopes, enforcing per-subject hash-chain
 *    continuity (`prev === head`, `seq === head.seq + 1`; genesis = `seq 0`,
 *    `prev null`). Gaps/forks are rejected; the unique `seq`/`record_id` indexes
 *    are the concurrency backstop (surfaced as `chain_conflict`).
 *  - Serve the ordered log from a cursor (`getLogSince`) and the chain head
 *    (`getHead`) for Oxy ingest.
 *  - Materialize the latest version of a record key (`getRecord`).
 *  - Pin and serve content-addressed blobs (`putBlob` / `getBlob`), validating
 *    the bytes hash to the supplied address.
 *
 * Signature verification and `recordId` computation happen OUTSIDE this class
 * (in {@link ../verify.ts}, reusing `@oxyhq/core`); the store is the integrity
 * and persistence layer and trusts the `recordId` passed to {@link appendRecord}.
 * All SQL goes through prepared statements with bound parameters.
 */

import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';
import { SCHEMA_SQL } from './schema.js';

type DatabaseInstance = Database.Database;
type PreparedStatement = Database.Statement;

/** A materialized log entry: chain coordinates + the full stored envelope. */
export interface StoredRecord {
  seq: number;
  collection: string;
  rkey: string;
  recordId: string;
  prev: string | null;
  issuedAt: number;
  envelope: SignedRecordEnvelope;
}

/** The current chain head (single per-subject head). */
export interface HeadInfo {
  seq: number;
  headRecordId: string;
  recordCount: number;
}

/** Outcome of appending a record to the chain. */
export type AppendOutcome =
  | { ok: true; recordId: string; seq: number }
  | { ok: false; reason: 'not_v2' | 'chain_gap' | 'chain_fork' | 'bad_seq' | 'chain_conflict' };

/** Thrown by {@link NodeStore.putBlob} when the bytes do not hash to the address. */
export class BlobHashMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`blob hash mismatch: expected ${expected}, computed ${actual}`);
    this.name = 'BlobHashMismatchError';
  }
}

interface RecordRow {
  seq: number;
  collection: string;
  rkey: string;
  record_id: string;
  prev: string | null;
  issued_at: number;
  envelope: string;
}

interface HeadRow {
  seq: number;
  head_record_id: string;
  record_count: number;
}

interface SeqRow {
  seq: number;
}

interface BlobRow {
  bytes: Buffer;
}

/** Pre-narrowed arguments to the atomic append transaction. */
interface AppendArgs {
  seq: number;
  collection: string;
  rkey: string;
  prev: string | null;
  issuedAt: number;
  envelopeJson: string;
  recordId: string;
}

/** A 64-char lowercase SHA-256 hex digest (the blob/record content address). */
const SHA256_HEX = /^[0-9a-f]{64}$/;

function isSqliteConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  );
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class NodeStore {
  private readonly db: DatabaseInstance;

  private readonly insertRecordStmt: PreparedStatement;
  private readonly upsertHeadStmt: PreparedStatement;
  private readonly getHeadStmt: PreparedStatement;
  private readonly getRecordStmt: PreparedStatement;
  private readonly logSinceStmt: PreparedStatement;
  private readonly seqByRecordIdStmt: PreparedStatement;
  private readonly putBlobStmt: PreparedStatement;
  private readonly getBlobStmt: PreparedStatement;

  /** The atomic append: continuity check + record insert + head advance. */
  private readonly appendTxn: (args: AppendArgs) => AppendOutcome;

  /**
   * @param databasePath - SQLite file path, or `':memory:'` for an ephemeral
   *   in-process database (used by tests).
   */
  constructor(databasePath: string) {
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);

    this.insertRecordStmt = this.db.prepare(
      `INSERT INTO records (seq, collection, rkey, record_id, prev, issued_at, envelope)
       VALUES (@seq, @collection, @rkey, @record_id, @prev, @issued_at, @envelope)`,
    );
    this.upsertHeadStmt = this.db.prepare(
      `INSERT INTO head (id, seq, head_record_id, record_count)
       VALUES (1, @seq, @head_record_id, 1)
       ON CONFLICT(id) DO UPDATE SET
         seq = @seq,
         head_record_id = @head_record_id,
         record_count = record_count + 1`,
    );
    this.getHeadStmt = this.db.prepare(`SELECT seq, head_record_id, record_count FROM head WHERE id = 1`);
    this.getRecordStmt = this.db.prepare(
      `SELECT seq, collection, rkey, record_id, prev, issued_at, envelope
       FROM records WHERE collection = @collection AND rkey = @rkey
       ORDER BY seq DESC LIMIT 1`,
    );
    this.logSinceStmt = this.db.prepare(
      `SELECT seq, collection, rkey, record_id, prev, issued_at, envelope
       FROM records WHERE seq > @since ORDER BY seq ASC LIMIT @limit`,
    );
    this.seqByRecordIdStmt = this.db.prepare(`SELECT seq FROM records WHERE record_id = @record_id`);
    this.putBlobStmt = this.db.prepare(
      `INSERT INTO blobs (hash, bytes, size, created_at)
       VALUES (@hash, @bytes, @size, @created_at)
       ON CONFLICT(hash) DO NOTHING`,
    );
    this.getBlobStmt = this.db.prepare(`SELECT bytes FROM blobs WHERE hash = @hash`);

    this.appendTxn = this.db.transaction((args: AppendArgs): AppendOutcome => {
      const { seq, collection, rkey, prev, issuedAt, envelopeJson, recordId } = args;

      const head = this.getHeadStmt.get() as HeadRow | undefined;
      const isGenesis = seq === 0 && prev === null;

      if (!head) {
        if (!isGenesis) {
          return { ok: false, reason: 'chain_gap' };
        }
      } else {
        if (prev !== head.head_record_id) {
          return { ok: false, reason: 'chain_fork' };
        }
        if (seq !== head.seq + 1) {
          return { ok: false, reason: 'bad_seq' };
        }
      }

      this.insertRecordStmt.run({
        seq,
        collection,
        rkey,
        record_id: recordId,
        prev,
        issued_at: issuedAt,
        envelope: envelopeJson,
      });
      this.upsertHeadStmt.run({ seq, head_record_id: recordId });

      return { ok: true, recordId, seq };
    });
  }

  /**
   * Append a verified v2 envelope, enforcing chain continuity. The envelope's
   * signature and `recordId` MUST already have been verified (see
   * {@link ../verify.ts}). Returns a typed outcome rather than throwing on a
   * chain violation so the route maps it to a 4xx.
   */
  appendRecord(env: SignedRecordEnvelope, recordId: string): AppendOutcome {
    if (
      env.version !== 2 ||
      typeof env.seq !== 'number' ||
      typeof env.collection !== 'string' ||
      typeof env.rkey !== 'string'
    ) {
      return { ok: false, reason: 'not_v2' };
    }

    // After the guards above, the chain fields are narrowed to their concrete
    // types; pass them explicitly so the transaction needs no casts.
    const args: AppendArgs = {
      seq: env.seq,
      collection: env.collection,
      rkey: env.rkey,
      prev: env.prev ?? null,
      issuedAt: env.issuedAt,
      envelopeJson: JSON.stringify(env),
      recordId,
    };

    try {
      return this.appendTxn(args);
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        return { ok: false, reason: 'chain_conflict' };
      }
      throw error;
    }
  }

  /** The current chain head, or `null` for an empty log. */
  getHead(): HeadInfo | null {
    const row = this.getHeadStmt.get() as HeadRow | undefined;
    if (!row) {
      return null;
    }
    return { seq: row.seq, headRecordId: row.head_record_id, recordCount: row.record_count };
  }

  /**
   * Ordered log entries strictly AFTER the `since` cursor.
   *
   * `since` may be a numeric `seq` (string or number) or a 64-hex `recordId`;
   * absent → from the start. An unknown `recordId` cursor yields an empty page.
   */
  getLogSince(since: string | number | undefined, limit: number): StoredRecord[] {
    const sinceSeq = this.resolveCursor(since);
    if (sinceSeq === null) {
      return [];
    }
    const rows = this.logSinceStmt.all({ since: sinceSeq, limit }) as RecordRow[];
    return rows.map((row) => this.toStoredRecord(row));
  }

  /** The latest (highest-`seq`) version of a record key, or `null`. */
  getRecord(collection: string, rkey: string): StoredRecord | null {
    const row = this.getRecordStmt.get({ collection, rkey }) as RecordRow | undefined;
    return row ? this.toStoredRecord(row) : null;
  }

  /**
   * Pin a content-addressed blob, validating that `bytes` hash to `hash`.
   * Idempotent: re-pinning the same hash is a no-op.
   *
   * @throws {BlobHashMismatchError} when the bytes do not hash to `hash`.
   */
  putBlob(hash: string, bytes: Buffer): void {
    const address = hash.toLowerCase();
    const actual = sha256Hex(bytes);
    if (actual !== address) {
      throw new BlobHashMismatchError(address, actual);
    }
    this.putBlobStmt.run({ hash: address, bytes, size: bytes.length, created_at: Date.now() });
  }

  /** The bytes of a pinned blob, or `null` if absent. */
  getBlob(hash: string): Buffer | null {
    const row = this.getBlobStmt.get({ hash: hash.toLowerCase() }) as BlobRow | undefined;
    return row ? row.bytes : null;
  }

  /** Close the underlying database (graceful shutdown / test teardown). */
  close(): void {
    this.db.close();
  }

  /**
   * Resolve a cursor to the exclusive lower-bound `seq`.
   * Returns `-1` (all records) for an absent cursor and `null` for an
   * unresolvable `recordId`.
   */
  private resolveCursor(since: string | number | undefined): number | null {
    if (since === undefined || since === null || since === '') {
      return -1;
    }
    if (typeof since === 'number') {
      return Number.isInteger(since) ? since : -1;
    }
    if (SHA256_HEX.test(since.toLowerCase())) {
      const row = this.seqByRecordIdStmt.get({ record_id: since.toLowerCase() }) as SeqRow | undefined;
      return row ? row.seq : null;
    }
    if (/^\d+$/.test(since)) {
      const parsed = Number(since);
      return Number.isSafeInteger(parsed) ? parsed : -1;
    }
    // An unrecognized cursor shape resolves to nothing rather than dumping the log.
    return null;
  }

  private toStoredRecord(row: RecordRow): StoredRecord {
    return {
      seq: row.seq,
      collection: row.collection,
      rkey: row.rkey,
      recordId: row.record_id,
      prev: row.prev,
      issuedAt: row.issued_at,
      envelope: JSON.parse(row.envelope) as SignedRecordEnvelope,
    };
  }
}
