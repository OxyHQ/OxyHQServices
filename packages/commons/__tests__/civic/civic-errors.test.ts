import { attestErrorCode, voteErrorCode } from '@/lib/civic/civic-errors';

describe('attestErrorCode', () => {
  it.each([
    ['Attestation rejected: nonce_used', 'nonce_used'],
    ['Attestation rejected: pair_cooldown', 'pair_cooldown'],
    ['Attestation rejected: excluded_graph_neighbor', 'excluded_graph_neighbor'],
    ['Attestation rejected: expired', 'expired'],
  ])('maps "%s" → %s', (message, code) => {
    expect(attestErrorCode(new Error(message))).toBe(code);
  });

  it('falls back to generic for an unmodelled reason or transport error', () => {
    expect(attestErrorCode(new Error('Network request failed'))).toBe('generic');
    expect(attestErrorCode(null)).toBe('generic');
  });
});

describe('voteErrorCode', () => {
  it.each([
    ['Vote rejected: request_closed', 'request_closed'],
    ['Vote rejected: already_voted', 'already_voted'],
  ])('maps "%s" → %s', (message, code) => {
    expect(voteErrorCode(new Error(message))).toBe(code);
  });

  it('maps the "not on this validation jury" sentence to not_selected', () => {
    expect(voteErrorCode(new Error('You are not on this validation jury'))).toBe('not_selected');
  });

  it('falls back to generic otherwise', () => {
    expect(voteErrorCode(new Error('boom'))).toBe('generic');
  });
});
