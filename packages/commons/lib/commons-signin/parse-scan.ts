/**
 * Single front door for the Commons QR scanner.
 *
 * A scanned string can be one of two unrelated Commons payloads:
 *
 *   - a "Sign in with Oxy" approval link  (`oxycommons://approve?code=…`)
 *   - a citizen DNI card                  (`oxydni://card?did=…`)
 *
 * `parseScan` branches a raw scanned string into a discriminated result so the
 * scanner can route once (`approval` → the existing `/approve` flow; `dni` →
 * the civic card view) without each call site re-implementing the matching.
 *
 * It delegates to the two pure, already-tested parsers — `parseApprovalLink`
 * (here) and `parseDniPayload` (from `@oxyhq/core`) — and never trusts the QR
 * for anything beyond the opaque `code` / `did` it carries: both are re-resolved
 * server-side.
 */

import { parseDniPayload } from '@oxyhq/core';
import { parseApprovalLink } from './parse-approval-link';

/** The branch a scanned string resolves to. */
export type ScanResult =
  /** A "Sign in with Oxy" approval link carrying a usable authorize code. */
  | { kind: 'approval'; code: string }
  /** A citizen DNI card carrying the subject's DID. */
  | { kind: 'dni'; did: string }
  /**
   * The string is not a recognized Commons payload, or is a recognized one that
   * can no longer be used. `reason: 'expired'` is reserved for an approval link
   * whose client-side expiry has already passed (better UX than a generic
   * "invalid"); everything else is `'invalid'`.
   */
  | { kind: 'invalid'; reason: 'invalid' | 'expired' };

/**
 * Branch a scanned QR string / deep link into its Commons payload kind.
 *
 * Approval links are matched first: an approve-scheme link that fails ONLY
 * because it is expired surfaces as `{ kind: 'invalid', reason: 'expired' }`
 * rather than falling through to the DNI matcher (the schemes never overlap, so
 * this only affects the error message shown).
 *
 * @param raw - The raw scanned string or deep-link URL.
 */
export function parseScan(raw: string): ScanResult {
  const approval = parseApprovalLink(raw);
  if (approval.ok) {
    return { kind: 'approval', code: approval.code };
  }
  // An approve-scheme link that matched but is stale: report it as expired so
  // the scanner can show the right message instead of "invalid".
  if (approval.reason === 'expired') {
    return { kind: 'invalid', reason: 'expired' };
  }

  const dni = parseDniPayload(raw);
  if (dni) {
    return { kind: 'dni', did: dni.did };
  }

  return { kind: 'invalid', reason: 'invalid' };
}
