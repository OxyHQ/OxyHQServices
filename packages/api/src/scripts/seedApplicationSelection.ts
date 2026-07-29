/**
 * Bound a `scripts/seed-oxy-applications.ts` run to an explicit subset of the
 * canonical seed list.
 *
 * The seed reconciles EVERY official application on every run, and several of
 * the fields it reconciles are authoritative replacements (`redirectUris`), so
 * registering ONE new application otherwise carries the blast radius of all the
 * others. `ONLY_APPS` removes that blast radius instead of merely warning about
 * it: the operator names the applications the run may touch, and the invocation
 * itself is the audit record.
 *
 * FAILS CLOSED, deliberately. Every rejected input below could instead have been
 * "quietly reconcile nothing", and that is the same failure shape as a dry run
 * reporting `appsUpdated: 0` before a real run changes something — a no-op that
 * reads as success, which the next operator then trusts. So:
 *
 *  - An unset `ONLY_APPS` means "the whole canonical list", the long-standing
 *    behaviour, unchanged.
 *  - A SET but empty / whitespace-only value throws. It is never read as "all":
 *    the dangerous misreading is an operator who meant to bound the run, passed
 *    a variable that happened to be empty, and got the full-blast-radius run.
 *  - An unknown name throws and names both what it could not match and what it
 *    could have — a typo must not silently shrink the run to nothing (or, worse,
 *    to some other app).
 *
 * Pure and dependency-free (no Mongoose, no env access) so the decision is unit
 * testable without a database, mirroring `registerCommonsClientsPlan.ts`.
 */

/** The only thing this module needs of a seed entry: its idempotency key. */
export interface NamedSeedEntry {
  name: string;
}

/**
 * Resolve the seed entries a run may touch.
 *
 * @param entries   The canonical seed list, in canonical order.
 * @param rawOnlyApps  The raw `ONLY_APPS` env value: `undefined` when unset, or
 *   a comma-separated list of application names to restrict the run to.
 * @returns The selected entries, in the canonical list's own order (never the
 *   order they were requested in — the seed's behaviour must not depend on how
 *   an operator happened to type the filter).
 * @throws When `rawOnlyApps` is set but selects nothing, or names an entry that
 *   is not in `entries`.
 */
export function selectSeedApplications<T extends NamedSeedEntry>(
  entries: readonly T[],
  rawOnlyApps: string | undefined
): T[] {
  if (rawOnlyApps === undefined) {
    return [...entries];
  }

  const requested = rawOnlyApps
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (requested.length === 0) {
    throw new Error(
      'ONLY_APPS was set but names no application. Unset it to seed every ' +
        'application, or name the ones this run may touch — it is never read ' +
        'as "all".'
    );
  }

  // Exact, case-sensitive match: `name` IS the idempotency key (with
  // createdByUserId), so a near-miss is a different application, not this one.
  const known = new Set(entries.map((entry) => entry.name));
  const unknown = requested.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `ONLY_APPS names unknown application(s): [${unknown.join(', ')}]. ` +
        `Known applications: [${entries.map((entry) => entry.name).join(', ')}].`
    );
  }

  const selected = new Set(requested);
  return entries.filter((entry) => selected.has(entry.name));
}
