/**
 * Map a thrown SDK error from a Fase 2 civic write to a stable code the UI shows
 * friendly copy for.
 *
 * The API rejects these writes with a message that embeds the server reason —
 * `"Attestation rejected: <reason>"` / `"Vote rejected: <reason>"` /
 * `"Vouch rejected: <reason>"` — which the SDK preserves on `Error.message`. Two
 * exceptions are sentences rather than `<verb> rejected: <reason>`: the jury
 * "not selected" case (`"You are not on this validation jury"`) and the vouch
 * `subject_not_found` case (`"Vouch subject not found"`), so they are matched
 * separately.
 *
 * Only the reasons we have localized copy for are recognized; anything else
 * (transport failures, unmodelled reasons) collapses to `'generic'`, so a screen
 * can always do `t('civic.<ns>.error.' + code)` and land on a real string.
 */

/** Recognized rejection codes for a real-life attestation submit. */
export type AttestErrorCode =
  | 'expired'
  | 'nonce_used'
  | 'pair_cooldown'
  | 'excluded_graph_neighbor'
  | 'generic';

/** Recognized rejection codes for a validation vote. */
export type VoteErrorCode = 'request_closed' | 'already_voted' | 'not_selected' | 'generic';

/** Recognized rejection codes for a personhood vouch submit. */
export type VouchErrorCode =
  | 'self_vouch'
  | 'already_vouched'
  | 'voucher_below_threshold'
  | 'excluded_graph_neighbor'
  | 'excluded_shared_device'
  | 'excluded_shared_ip'
  | 'subject_not_found'
  | 'generic';

const ATTEST_REASONS: readonly Exclude<AttestErrorCode, 'generic'>[] = [
  'expired',
  'nonce_used',
  'pair_cooldown',
  'excluded_graph_neighbor',
];

const VOTE_REASONS: readonly Exclude<VoteErrorCode, 'generic' | 'not_selected'>[] = [
  'request_closed',
  'already_voted',
];

const VOUCH_REASONS: readonly Exclude<VouchErrorCode, 'generic' | 'subject_not_found'>[] = [
  'self_vouch',
  'voucher_below_threshold',
  'already_vouched',
  'excluded_graph_neighbor',
  'excluded_shared_device',
  'excluded_shared_ip',
];

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
}

/** Classify a real-life-attestation submit error. */
export function attestErrorCode(error: unknown): AttestErrorCode {
  const msg = messageOf(error);
  return ATTEST_REASONS.find((reason) => msg.includes(reason)) ?? 'generic';
}

/** Classify a validation-vote error. */
export function voteErrorCode(error: unknown): VoteErrorCode {
  const msg = messageOf(error);
  const match = VOTE_REASONS.find((reason) => msg.includes(reason));
  if (match) return match;
  // `not_selected` surfaces as the sentence "You are not on this validation jury".
  if (msg.includes('not on this validation jury') || msg.includes('not_selected')) {
    return 'not_selected';
  }
  return 'generic';
}

/** Classify a personhood-vouch submit error. */
export function vouchErrorCode(error: unknown): VouchErrorCode {
  const msg = messageOf(error);
  const match = VOUCH_REASONS.find((reason) => msg.includes(reason));
  if (match) return match;
  // `subject_not_found` surfaces as the sentence "Vouch subject not found".
  if (msg.includes('subject not found') || msg.includes('subject_not_found')) {
    return 'subject_not_found';
  }
  return 'generic';
}
