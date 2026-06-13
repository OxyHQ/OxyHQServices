/**
 * coldBoot — a pure, ordered, short-circuit runner for "cold boot"
 * authentication resolution.
 *
 * On a fresh page load / app launch the SDK may have several ways to recover an
 * existing session (silent FedCM, a persisted refresh token, a cross-domain
 * claim, an explicit popup flow, …). They must be attempted in a *deterministic
 * order*, and the FIRST one that yields a session wins — every later step is
 * skipped. This module encodes exactly that contract and nothing else.
 *
 * Design constraints (all enforced):
 *   - PURE: no DOM, no `navigator`, no `window`, no React, no platform globals.
 *   - NO module-level mutable state. Every call to {@link runColdBoot} is fully
 *     self-contained, so it is safe under bundler re-evaluation (e.g. the Metro
 *     web bundle, which is precisely why the FedCM silent-SSO guard had to live
 *     in consumers rather than a core singleton).
 *   - Architecture-agnostic: both candidate cross-domain SSO designs consume
 *     this same primitive; it knows nothing about HOW a step resolves a session.
 *
 * A step is skipped (without running) when its `enabled` predicate returns
 * false. Any thrown error — from either `enabled` or `run` — is reported via
 * `onStepError` and treated as a non-fatal skip, so one broken recovery path
 * can never prevent a later, healthy one from succeeding.
 */

/**
 * A successful step result carrying the recovered session.
 */
export interface ColdBootSession<S> {
  readonly kind: 'session';
  readonly session: S;
}

/**
 * A step result indicating this step has nothing to contribute; the runner
 * should fall through to the next step.
 */
export interface ColdBootSkip {
  readonly kind: 'skip';
}

/**
 * The result of running a single cold-boot step.
 */
export type ColdBootStepResult<S> = ColdBootSession<S> | ColdBootSkip;

/**
 * A single ordered cold-boot recovery step.
 */
export interface ColdBootStep<S> {
  /** Stable identifier; surfaced as {@link ColdBootOutcome.via} on success. */
  readonly id: string;
  /**
   * Optional gate. When provided and it returns `false`, `run` is NOT called
   * and the runner moves to the next step. A throw is treated as disabled
   * (and reported via `onStepError`).
   */
  readonly enabled?: () => boolean;
  /**
   * Attempts to recover a session. Resolve with `{ kind: 'session' }` to win
   * the cold boot, or `{ kind: 'skip' }` to defer to the next step. A throw is
   * treated as a skip (and reported via `onStepError`).
   */
  readonly run: () => Promise<ColdBootStepResult<S>>;
}

/**
 * The terminal outcome of a cold boot: either the winning step's session
 * (with the step `id` it came from), or `unauthenticated` if every step
 * skipped, was disabled, or errored.
 */
export type ColdBootOutcome<S> =
  | { readonly kind: 'session'; readonly via: string; readonly session: S }
  | { readonly kind: 'unauthenticated' };

/**
 * Options for {@link runColdBoot}.
 */
export interface RunColdBootOptions<S> {
  /** Ordered steps; evaluated front to back, first session wins. */
  readonly steps: ReadonlyArray<ColdBootStep<S>>;
  /**
   * Optional observer invoked whenever a step's `enabled` or `run` throws.
   * Receives the offending step `id` and the thrown value. Must not throw;
   * the runner does not guard against an observer that itself throws.
   */
  readonly onStepError?: (id: string, error: unknown) => void;
}

/**
 * Run the ordered cold-boot steps and resolve to the first recovered session,
 * or `unauthenticated` if none recovers one.
 *
 * Semantics:
 *   1. Iterate `steps` in order.
 *   2. If a step has an `enabled` predicate, call it inside try/catch:
 *      - throw → report via `onStepError(id, err)` → treat as disabled → continue.
 *      - returns false → continue (skip, `run` not called).
 *   3. Otherwise await `step.run()` inside try/catch:
 *      - throw → report via `onStepError(id, err)` → continue.
 *      - `{ kind: 'session' }` → return `{ kind: 'session', via: step.id, session }`.
 *      - `{ kind: 'skip' }` → continue.
 *   4. After the loop with no winner → `{ kind: 'unauthenticated' }`.
 */
export async function runColdBoot<S>(
  options: RunColdBootOptions<S>
): Promise<ColdBootOutcome<S>> {
  const { steps, onStepError } = options;

  for (const step of steps) {
    if (step.enabled) {
      let isEnabled: boolean;
      try {
        isEnabled = step.enabled();
      } catch (error) {
        onStepError?.(step.id, error);
        continue;
      }
      if (!isEnabled) continue;
    }

    let result: ColdBootStepResult<S>;
    try {
      result = await step.run();
    } catch (error) {
      onStepError?.(step.id, error);
      continue;
    }

    if (result.kind === 'session') {
      return { kind: 'session', via: step.id, session: result.session };
    }
  }

  return { kind: 'unauthenticated' };
}
