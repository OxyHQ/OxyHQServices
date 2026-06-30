/**
 * Record verification — reuses `@oxyhq/protocol` so a record verifies on the
 * node with the EXACT code Oxy uses. No crypto is re-implemented here:
 *
 *  - {@link verifyEnvelopeSignature} recomputes the canonical signing input
 *    (the bytes the signature covers) from the envelope's own fields and checks
 *    the secp256k1 DER signature against the envelope's embedded `publicKey`.
 *  - {@link computeRecordId} recomputes `recordId = sha256(signingInput)` — the
 *    content address used as the chain's `prev` pointer.
 *
 * The envelope shape is validated with the shared `signedRecordEnvelopeSchema`
 * from `@oxyhq/contracts` (the same schema the API uses). The node is a v2 hash
 * chain, so only v2 envelopes (carrying `seq`/`prev`/`collection`/`rkey`) are
 * accepted; v1 singletons have no chain coordinates.
 *
 * Verification here proves the signature is internally consistent with the
 * embedded `publicKey`. Whether that key is authorized for the subject is the
 * OWNER check (see {@link ./auth.ts}) — on a node the authority is the
 * configured owner public key, not a DID lookup.
 */

import { computeRecordId, verifyEnvelopeSignature } from '@oxyhq/protocol';
import { signedRecordEnvelopeSchema, type SignedRecordEnvelope } from '@oxyhq/contracts';

/** Stable, machine-readable reasons an envelope can fail verification. */
export type VerifyRejectionReason = 'invalid_envelope' | 'not_v2' | 'bad_signature';

export type VerifyResult =
  | { ok: true; envelope: SignedRecordEnvelope; recordId: string }
  | { ok: false; reason: VerifyRejectionReason };

/**
 * Validate, signature-check, and content-address a candidate signed record.
 *
 * On success the parsed envelope and its `recordId` are returned; the caller
 * (the route) still enforces owner authority and chain continuity before the
 * record is appended.
 */
export async function verifyRecordEnvelope(input: unknown): Promise<VerifyResult> {
  const parsed = signedRecordEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_envelope' };
  }

  const envelope = parsed.data;
  if (envelope.version !== 2) {
    return { ok: false, reason: 'not_v2' };
  }

  const signatureValid = await verifyEnvelopeSignature(envelope);
  if (!signatureValid) {
    return { ok: false, reason: 'bad_signature' };
  }

  const recordId = await computeRecordId(envelope);
  return { ok: true, envelope, recordId };
}
