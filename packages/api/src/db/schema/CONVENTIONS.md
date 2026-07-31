# Postgres schema conventions

Binding for every table in this migration. Decision + reason, nothing else.
The prime directives live in the migration contract: **no relational link may be
lost**, and **no Mongo baggage travels**. Where a Mongoose detail has no Postgres
counterpart, the semantic is preserved and the mechanism is redesigned.

Several of these are enforced by tests, not by discipline — see the bottom.

---

## Naming

**Tables: explicit snake_case, plural.** `push_tokens`, not Mongoose's derived
`pushtokens`. The derived name is a `pluralize()` artifact, not a design
(`appaffinityeventseens` is not a word), and nothing reads a collection name —
call sites are being rewritten, not shimmed. The backfill therefore needs an
explicit collection → table map; write it out, one entry per table.

**Columns: camelCase in TypeScript, snake_case in SQL**, derived by drizzle. Do
not pass an explicit column name unless the SQL name genuinely differs from the
property.

**`db/casing.ts` is the naming authority.** `DATABASE_CASING` is read by
`drizzle()` (what queries reference), by `drizzle.config.ts` (what the DDL
creates), and by `sqlColumnName`. One setting, not three copies.

> **Trap:** `column.name` on a drizzle column is the TypeScript **property** name
> (`expiresAt`), never the SQL name (`expires_at`) — casing is applied when SQL
> is built. Using it in hand-written SQL throws `column "expiresAt" does not
> exist`; using it in a catalogue query or a `endsWith('_id')` filter silently
> matches nothing and the check passes vacuously. Always `sqlColumnName(column)`,
> or interpolate the Column itself into `sql` and let drizzle render it.

**Reserved words are fine.** `labels.order` stays `order`; drizzle quotes every
identifier it emits. Hand-written SQL must quote it too. Renaming it would put a
gratuitous divergence between the schema and the wire contract.

## Primary keys

`text`, holding the 24-char ObjectId hex verbatim for pre-cutover rows and a
**uuid v7** for new ones. Decided in the contract — the column type is uniform,
the value format is mixed, and that is data rather than debt only while nothing
parses an id.

**v7 is generated in the application** (`generatedId()` in `columns.ts`, via
`$defaultFn`), not by a database `DEFAULT`. Postgres 17 has no native `uuidv7()`
(it lands in 18); the alternatives are the `pg_uuidv7` extension or a
hand-maintained plpgsql function, either of which must be installed identically
in dev, CI and RDS before the first migration can run. Generating in the
application also means the id is known before the insert round-trip. Rows
inserted by raw SQL get no id — intended: the backfill supplies `_id` verbatim,
which is how every existing foreign key survives.

**One exception:** `link_previews.id` is the SHA-256 of the normalized URL and is
always supplied by the caller, so it is a plain `text().primaryKey()` with no
default. A table whose id is content-addressed says so by having no generator.

## Closed value sets

**`text` + a CHECK constraint. Never a pg `enum` type.**

- `text({ enum: [...] })` gives drizzle the same literal-union TypeScript type an
  enum would, so the enum type buys nothing at compile time.
- Adding a value to a pg enum is easy; **removing or renaming one is not
  possible** — you create a new type, alter every column, drop the old. A CHECK
  is ordinary `DROP CONSTRAINT` / `ADD CONSTRAINT`, reviewable in the generated
  SQL, and symmetric for add and remove.
- Declare the values once as a `const` tuple and derive both the column type and
  the CHECK from it, so they cannot drift.

A CHECK is also a place to REMOVE Mongo baggage. `auth_challenges.purpose` was
optional in Mongo, so every reader carried `{ $in: ['signin', null] }` for
documents predating the field; here it is `NOT NULL DEFAULT 'signin'` with a
CHECK, the backfill maps null once, and the legacy branch does not travel.

## Timestamps

Always `timestamptz`, always `mode: 'date'` (`timestamptz()` in `columns.ts`).
`timestamp` without a time zone reinterprets the value in the session's
`TimeZone` on every read, silently changing what a Mongo `Date` meant.

| Mongoose | Postgres |
|---|---|
| `timestamps: true` | `created_at` + `updated_at`, both `NOT NULL DEFAULT now()` |
| `timestamps: { createdAt: true, updatedAt: false }` | `created_at` only — the ABSENCE of `updated_at` is the append-only contract |
| `timestamps: false` + own `createdAt: { default: Date.now }` | `created_at`, identical to the row above; the Mongoose distinction has no Postgres counterpart |

**`updated_at` is maintained by the application** (`$onUpdate`), matching what
Mongoose did. Deliberately not a trigger: a trigger is invisible in the schema
file, and it would fire during backfill and maintenance writes and overwrite the
historical value the migration exists to preserve.

## Foreign keys

Every relation gets a real constraint with an **explicitly decided `ON DELETE`**.
Postgres will now enforce integrity Mongo only hoped for; do not waste it.

A table can land before its parent, and drizzle cannot express a forward
reference. Such a foreign key goes in `DEFERRED_FOREIGN_KEYS`
(`deferredForeignKeys.ts`) **as data, with its `ON DELETE` and reason already
decided** — and the test turns it into a gate: the moment the parent table
appears in the barrel, the run goes red naming every column that must now
reference it. An empty ledger is the finish line.

`ID_COLUMNS_WITHOUT_FOREIGN_KEY` is the permanent counterpart: `*_id` columns
that will never carry a constraint (a cross-service id like `bookmarks.post_id`,
or an id-shaped value that is not a row id at all). Between the two lists and the
real constraints, every id-shaped column is classified, which is what lets a NEW
unclassified one fail.

**`ON DELETE SET NULL` needs care where NULL already means something.**
`push_tokens.application_id` is `CASCADE`, not `SET NULL`, because NULL there
means "not scoped to any application" — `SET NULL` would promote a dead app's
install into the unscoped delivery set instead of retiring it.

`ON UPDATE` is never declared: ids are immutable.

## Expiry — the Mongo TTL replacement

Postgres has no TTL index and 14 models relied on one. The mechanism is defined
once in `db/expiry.ts`; a table adds a registry entry rather than its own cleanup
path. An entry is the exact analogue of a Mongo TTL index —
`{ table, column, retentionSeconds }` → `delete where column <= now() - N` — so
all three uses in the Mongo schema map onto it without loss:

| Mongo | Registry entry |
|---|---|
| `expireAfterSeconds: 0` on `expiresAt` | the column IS the deadline, `retentionSeconds: 0` |
| `expireAfterSeconds: N` on `createdAt` | retention window on a birth column |
| `expireAfterSeconds: N` on `expiresAt` (grace) | same shape, different column — the row deliberately outlives its own deadline so a read can answer "expired" rather than "never existed" |

Every registered column MUST have a supporting btree index (the sweep's predicate
is a range scan; Mongo's TTL index carried the same obligation). Deletion is
batched via `ctid` so a backlog cannot hold one long transaction open.

**Coexistence with reads — the part that must not be lost.** Mongo's TTL monitor
lags ~60s; a sweep lags one interval. Two classes of read path exist and they are
not interchangeable:

- **(A) Reads that filter on expiry themselves** — `expiresAt: { $gt: new Date() }`
  in `session.controller.ts:297`, `authSession.service.ts:280`,
  `authLinking.ts:303`. For these the sweep is pure housekeeping. **Port every
  one of those filters verbatim.** Dropping one because "the sweep handles it"
  turns a bounded lag into a live credential.
- **(B) Reads that do NOT filter and rely on the row already being gone** —
  `senderAvatar.service.ts:179` and `:208` return the cached row with no expiry
  predicate and no application-side check. There the sweep is a CORRECTNESS
  mechanism and the interval is how stale a served value can be. On port, ADD the
  read-side filter and move them into class (A); then no table's correctness
  depends on a job running.

Scheduling belongs with the call-site port, alongside the existing BullMQ
repeatable jobs. The mechanism is complete and tested; nothing reads a swept
table yet.

## Unique constraints

Mongo unique index → `UNIQUE`. Mongo `partialFilterExpression` → a Postgres
partial unique index (`uniqueIndex().where(...)`).

**Do NOT carry over the `default: undefined` workaround.**
`DeviceSession.secretHash` and `AuthSession.authorizeCode` use it because Mongo's
sparse unique index collides on nulls. Postgres unique indexes treat NULLs as
DISTINCT by default, so a plain `UNIQUE` on a nullable column is already correct.
And it must **never** become `''` — an empty string is a VALUE, so it collides
for real, converting a non-problem into a live bug.

**Case-insensitive unique: a unique index on `lower(name)`, not `citext`.**
`labels` had Mongo's `collation: { locale: 'en', strength: 2 }`.

- `citext` is an extension: `CREATE EXTENSION` would have to run in dev, CI and
  RDS before the first migration, an ordering dependency in every environment for
  one column.
- `citext` changes behaviour for EVERY comparison on that column, including ones
  the author never considered, and its equivalence to `strength: 2` is a
  coincidence rather than a construction.
- An expression index makes the case-insensitivity visible AT the constraint and
  leaves the stored value exactly as the user typed it, as Mongo did.

The cost, and it is real: **every lookup must be written
`where user_id = $1 and lower(name) = lower($2)`.** A plain `name = $2` is
correct-looking, case-sensitive, and will not use the index.

## Arrays and objects

- A scalar array (`transports: [String]`) → a native `type[]`. Postgres arrays
  are first-class; a child table for ≤5 values never queried by element is
  over-normalization.
- An array of IDS or entities → a real junction table with real foreign keys.
  Never a `jsonb` id array: it cannot be joined, constrained, or usefully
  indexed.
- A `Mixed`/`Map`/nested object with a known shape → real columns or a child
  table. `jsonb` is for genuinely shape-less data only.
- `default: undefined` on an array means "absent", which is a nullable column
  with NO default — not `'{}'`, which is a different value.

## Mongoose behaviour that has no schema counterpart

`trim: true`, `lowercase: true`, and setter-style defaults are Mongoose
APPLICATION behaviour, not schema. Postgres has no equivalent, and dropping them
silently changes what gets stored (`push_tokens.token` was trimmed;
`SenderAvatar.email` was lower-cased). **Re-apply each one at the call site
during the port.** They are deliberately NOT encoded as CHECK constraints here: a
CHECK would reject existing production rows during backfill and convert a silent
normalization into a 500.

`select: false` likewise does not survive. Drizzle enumerates columns explicitly,
so `db.select().from(t)` returns EVERYTHING — including
`link_previews.origin_image_url`, which is server-only and would leak the
viewer's IP to the origin if serialized. Reads that feed a client DTO must select
columns explicitly. (The global mechanism for the 11 `select: false` columns on
User/Message is decided separately in the contract.)

## Indexes

Port the indexes that earn their keep, drop the ones that do not, add the ones
Mongo needed and lacked. All three happened here:

- **Dropped as redundant:** a standalone `{userId: 1}` alongside a compound
  unique that already leads with `user_id` — a btree serves any leading prefix.
- **Dropped as redundant:** `auth_challenges` `{publicKey, challenge}`, when
  every read is keyed on the high-entropy `challenge` the unique index answers.
- **Added as a fix:** `blocks(blocked_id)`. `graphExclusion.ts:47` and
  `user.service.ts:1661` both query that direction, which Mongo's
  `{userId, blockedId}` index could not serve — a full collection scan today.
- **Added because the table had none:** `bookmarks(user_id)`.

Do not add an index speculatively. `labels` gets none for its `order, name` sort:
a user holds a few dozen labels and sorting them is free.

---

## What is enforced by a test

Not by discipline — these fail the build.

| Convention | Test |
|---|---|
| Deferred FK becomes mandatory when its parent lands | `schema/__tests__/foreignKeys.test.ts` |
| Every id-shaped column is classified | same |
| snake_case tables and columns; every table has a PK | `schema/__tests__/schemaInvariants.test.ts` |
| Every timestamp is `timestamptz` | same |
| No `''` default; no `__v` / `_id` | same |
| Case-insensitive unique, compound unique, CHECK sets, bytea round-trip, id format and ordering, `updated_at` maintenance | `schema/__tests__/constraints.test.ts` |
| Sweep semantics, batching, and the index each swept column requires | `db/__tests__/expiry.test.ts` |

All of them run against a real Postgres through the application's own pool. Each
has been mutation-tested: break the thing it guards and it goes red naming the
offending table and column.
