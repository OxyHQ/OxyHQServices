/**
 * SQLite schema for the node's append-only signed-record log + blob store.
 *
 * The node holds a SINGLE owner's personal repo, so the hash chain is a single
 * per-subject chain (mirroring Oxy's per-subject `RepoHead` — a node has exactly
 * one subject). `seq` is therefore globally monotonic and unique.
 *
 *  - `records` — one row per appended envelope, keyed `(collection, rkey, seq)`
 *    so a record key can carry multiple chained versions (last-writer-wins).
 *    `seq` and `record_id` are each globally unique (the chain backstop).
 *  - `head`    — a single row (`id = 1`) mirroring `RepoHead`: the current chain
 *    tip (`seq` + `head_record_id`) and total `record_count`, for O(1) lookup.
 *  - `blobs`   — content-addressed binary store keyed by SHA-256 hex `hash`.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS records (
  seq         INTEGER NOT NULL,
  collection  TEXT    NOT NULL,
  rkey        TEXT    NOT NULL,
  record_id   TEXT    NOT NULL,
  prev        TEXT,
  issued_at   INTEGER NOT NULL,
  envelope    TEXT    NOT NULL,
  PRIMARY KEY (collection, rkey, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_records_seq ON records (seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_record_id ON records (record_id);

CREATE TABLE IF NOT EXISTS head (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  seq             INTEGER NOT NULL,
  head_record_id  TEXT    NOT NULL,
  record_count    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blobs (
  hash        TEXT    PRIMARY KEY,
  bytes       BLOB    NOT NULL,
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
`;
