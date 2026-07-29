/**
 * THE INVARIANT of `ONLY_APPS`: a run is bounded to exactly the applications
 * named, or it refuses to run at all. It never silently reconciles nothing, and
 * it never silently reconciles everything.
 *
 * Why this suite exists: `scripts/seed-oxy-applications.ts` reconciles EVERY
 * official application on every run, and some of what it reconciles is an
 * authoritative replacement. Registering one new application therefore carried
 * the blast radius of all the others, and the script's `DRY_RUN` cannot warn
 * about it (its whole reconcile block lives inside `if (!dryRun)`, so a dry run
 * reports `appsUpdated: 0` for every existing app no matter what the real run
 * would change — the same bug `registerCommonsClientsPlan.test.ts` pins for the
 * sibling script). `ONLY_APPS` removes the blast radius instead of improving the
 * warning about it, so the guard rails on it are the safety property.
 *
 * The failure this pins hardest is the QUIET one: every rejection below could
 * instead have been "select nothing and report success", which is the exact
 * shape of a decorative safety net.
 */

import { selectSeedApplications } from '../seedApplicationSelection';

/** Stands in for the real SEED_APPS: only `name` is load-bearing here. */
const ENTRIES = [
  { name: 'Oxy Accounts', type: 'first_party' },
  { name: 'Commons by Oxy', type: 'first_party' },
  { name: 'CrowdSource', type: 'first_party' },
] as const;

describe('selectSeedApplications', () => {
  describe('unset — the long-standing behaviour is unchanged', () => {
    it('returns the whole canonical list', () => {
      expect(selectSeedApplications(ENTRIES, undefined)).toEqual([...ENTRIES]);
    });

    it('returns a copy, so a caller cannot mutate the canonical list', () => {
      const selected = selectSeedApplications(ENTRIES, undefined);
      expect(selected).not.toBe(ENTRIES);
    });
  });

  describe('bounding a run', () => {
    it('selects exactly the one application named', () => {
      expect(selectSeedApplications(ENTRIES, 'CrowdSource')).toEqual([
        { name: 'CrowdSource', type: 'first_party' },
      ]);
    });

    it('does NOT select the applications it was not given — the whole point', () => {
      const selected = selectSeedApplications(ENTRIES, 'CrowdSource').map((e) => e.name);
      expect(selected).not.toContain('Commons by Oxy');
      expect(selected).not.toContain('Oxy Accounts');
    });

    it('selects several, and tolerates whitespace around the separators', () => {
      expect(
        selectSeedApplications(ENTRIES, ' CrowdSource , Oxy Accounts ').map((e) => e.name)
      ).toEqual(['Oxy Accounts', 'CrowdSource']);
    });

    it('returns canonical order, never the order the operator typed', () => {
      expect(
        selectSeedApplications(ENTRIES, 'CrowdSource,Oxy Accounts').map((e) => e.name)
      ).toEqual(['Oxy Accounts', 'CrowdSource']);
    });

    it('de-duplicates a repeated name instead of seeding it twice', () => {
      expect(
        selectSeedApplications(ENTRIES, 'CrowdSource,CrowdSource').map((e) => e.name)
      ).toEqual(['CrowdSource']);
    });

    it('preserves an internal space in a name (the separator is a comma)', () => {
      expect(selectSeedApplications(ENTRIES, 'Commons by Oxy').map((e) => e.name)).toEqual([
        'Commons by Oxy',
      ]);
    });
  });

  describe('fails closed — a rejection is never a silent no-op', () => {
    it('throws when set but empty, rather than seeding everything', () => {
      expect(() => selectSeedApplications(ENTRIES, '')).toThrow(/names no application/);
    });

    it('throws on whitespace only', () => {
      expect(() => selectSeedApplications(ENTRIES, '   ')).toThrow(/names no application/);
    });

    it('throws on separators only', () => {
      expect(() => selectSeedApplications(ENTRIES, ' , , ')).toThrow(/names no application/);
    });

    it('throws on an unknown name instead of selecting nothing', () => {
      expect(() => selectSeedApplications(ENTRIES, 'Crowdsource')).toThrow(
        /unknown application\(s\): \[Crowdsource\]/
      );
    });

    it('names the valid options, so a typo is self-correcting', () => {
      expect(() => selectSeedApplications(ENTRIES, 'Nope')).toThrow(/CrowdSource/);
    });

    it('rejects the WHOLE run when one of several names is unknown', () => {
      // Partial success is the dangerous outcome: the operator reads "done" and
      // the application they cared about was never touched.
      expect(() => selectSeedApplications(ENTRIES, 'CrowdSource,Nope')).toThrow(
        /unknown application\(s\): \[Nope\]/
      );
    });

    it('is case-sensitive, because `name` is the idempotency key', () => {
      // A near-miss identifies a DIFFERENT application (or none): matching it
      // loosely would reconcile the wrong record under the right-looking name.
      expect(() => selectSeedApplications(ENTRIES, 'crowdsource')).toThrow(/unknown/);
    });

    it('does not substring-match a longer name', () => {
      expect(() => selectSeedApplications(ENTRIES, 'Crowd')).toThrow(/unknown/);
    });
  });

  describe('vacuity floor', () => {
    it('the fixture actually distinguishes selected from unselected', () => {
      // If ENTRIES ever collapsed to one entry, every "does not select" test
      // above would pass for the wrong reason.
      expect(ENTRIES.length).toBeGreaterThan(1);
      expect(selectSeedApplications(ENTRIES, 'CrowdSource').length).toBeLessThan(ENTRIES.length);
    });
  });
});
