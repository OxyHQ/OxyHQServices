/**
 * Deliberately-signed-out gate (Option B) — services consumer helpers.
 *
 * After an EXPLICIT full sign-out, a still-live central IdP session (FedCM
 * credential association / per-apex `fedcm_session` cookie) would let the
 * `fedcm-silent` / per-apex `/auth/silent` cold-boot steps silently re-mint a
 * session on the next reload, signing the user back in without intent. The
 * durable per-origin "deliberately signed out" flag (core `ssoSignedOutKey`,
 * read via `silentRestoreSuppressed`) gates those steps off until the next
 * deliberate sign-in clears it.
 *
 * These helpers are the consumer side of that contract: `markSignedOut` (set on
 * full sign-out), `clearSignedOut` (cleared on any deliberate sign-in), and
 * `isSilentRestoreSuppressed` (read by the cold-boot `enabled` gates). They are
 * pure `localStorage` wrappers over the core key, so they run under the jsdom
 * test env without rendering any React.
 */

import { ssoSignedOutKey } from '@oxyhq/core';
import {
  markSignedOut,
  clearSignedOut,
  isSilentRestoreSuppressed,
} from '../../src/ui/utils/activeAuthuser';

// jsdom's default origin.
const ORIGIN = 'http://localhost';
const KEY = ssoSignedOutKey(ORIGIN);

describe('silent-restore gate helpers (Option B)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to NOT suppressed when nothing was signed out', () => {
    expect(isSilentRestoreSuppressed()).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('markSignedOut sets the durable flag → silent restore is suppressed', () => {
    markSignedOut();
    expect(window.localStorage.getItem(KEY)).toBe('1');
    expect(isSilentRestoreSuppressed()).toBe(true);
  });

  it('clearSignedOut removes the flag → silent restore is re-enabled (no stuck state)', () => {
    markSignedOut();
    expect(isSilentRestoreSuppressed()).toBe(true);

    clearSignedOut();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(isSilentRestoreSuppressed()).toBe(false);
  });

  it('a deliberate sign-in after sign-out fully clears suppression (sign-out → sign-in cycle)', () => {
    // Sign out: suppressed.
    markSignedOut();
    expect(isSilentRestoreSuppressed()).toBe(true);
    // Deliberate sign-in clears it: silent restore works again on the next boot.
    clearSignedOut();
    expect(isSilentRestoreSuppressed()).toBe(false);
    // A subsequent sign-out re-arms it (idempotent, repeatable).
    markSignedOut();
    expect(isSilentRestoreSuppressed()).toBe(true);
  });
});
