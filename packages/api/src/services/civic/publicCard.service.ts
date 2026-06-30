/**
 * Public DNI Card Service (civic / Commons — Fase 1).
 *
 * Assembles the public, verifiable "DNI" card for a user and seals it with an
 * Oxy custodial attestation (`ES256K-DER-SHA256` over the canonical-JSON of the
 * card — the same scheme as the signed data export). A scanner resolves the card
 * by DID and verifies the Oxy signature OFFLINE, so the QR only ever carries the
 * DID (no trust data → nothing to spoof).
 *
 * The card composes ONLY public, canonical account fields: the DID, the
 * canonical `name.displayName` (via `formatUserResponse` — never recomposed),
 * the public `cloud.oxy.so` avatar URL, the reputation trust tier, verified
 * domains, and (empty until Fase 3/4) personhood status + credential badges.
 *
 * The attestation is `null` only when the Oxy signing key is unconfigured (dev /
 * pre-prod); in production it is always present — exactly like the export bundle.
 */

import type { PublicCard, SignedPublicCard, ExportAttestation, PersonhoodStatus as PersonhoodStatusValue } from '@oxyhq/contracts';
import { signedPublicCardSchema } from '@oxyhq/contracts';
import { canonicalize } from '@oxyhq/protocol';
import { User } from '../../models/User';
import { ReputationBalance } from '../../models/ReputationBalance';
import PersonhoodStatusModel from '../../models/PersonhoodStatus';
import SignatureService from '../signature.service';
import { buildUserDid, OXY_DID } from '../did.service';
import { formatUserResponse } from '../../utils/userTransform';
import { getAssetCdnUrl } from '../../config/cdn';
import { logger } from '../../utils/logger';

const ALG = 'ES256K-DER-SHA256' as const;

/**
 * Sign the card with the Oxy custodial key. Returns `null` (and logs) when
 * `OXY_PRIVATE_KEY`/`OXY_PUBLIC_KEY` are unconfigured — mirrors the export
 * bundle so the card never crashes on a missing key.
 *
 * The signature covers `canonicalize(card)`; the card is assembled with only the
 * keys that are actually present (optional `username`/`avatarUrl` are omitted,
 * not set to `undefined`), so a consumer re-canonicalizing the received card
 * derives byte-identical bytes.
 */
function signCard(card: PublicCard): ExportAttestation | null {
  const privateKey = process.env.OXY_PRIVATE_KEY;
  const publicKey = process.env.OXY_PUBLIC_KEY;
  if (!privateKey || !publicKey) {
    logger.warn('Public card attestation omitted: OXY_PRIVATE_KEY/OXY_PUBLIC_KEY not configured', {
      component: 'civic.publicCard',
    });
    return null;
  }
  const signature = SignatureService.signMessage(canonicalize(card), privateKey);
  return { issuer: OXY_DID, publicKey, alg: ALG, signature, signedAt: Date.now() };
}

/**
 * Build the signed public card for `userId`, or `null` when the user is absent.
 * The returned object is validated against `signedPublicCardSchema`.
 */
export async function buildSignedPublicCard(userId: string): Promise<SignedPublicCard | null> {
  const user = await User.findById(userId)
    .select('username name avatar publicKey verified verifiedDomains')
    .lean();
  if (!user) {
    return null;
  }

  const formatted = formatUserResponse(user);
  // formatUserResponse composes the canonical `name.displayName`; fall back to
  // the username only if (impossibly) absent so `name` is always a string.
  const displayName = formatted?.name?.displayName ?? formatted?.username ?? '';
  const username = formatted?.username;
  const avatarId = formatted?.avatar;

  const [balance, personhood] = await Promise.all([
    ReputationBalance.findOne({ userId }).lean(),
    PersonhoodStatusModel.findOne({ userId }).select('isRealPerson').lean<{ isRealPerson?: boolean } | null>(),
  ]);
  const trustTier = balance?.trustTier ?? 'new';

  // Personhood (Fase 3): a confirmed real person is `verified`; a user who has a
  // status row but has not yet crossed θ is `pending`; no row at all is
  // `unverified`.
  const personhoodStatus: PersonhoodStatusValue = !personhood
    ? 'unverified'
    : personhood.isRealPerson
      ? 'verified'
      : 'pending';

  const verifiedDomains = (user.verifiedDomains ?? []).map((domain) => domain.domain);

  const card: PublicCard = {
    did: buildUserDid(userId),
    userId,
    name: displayName,
    trustTier,
    personhoodStatus,
    verifiedDomains,
    credentialBadges: [],
    issuedAt: Date.now(),
  };
  // Only attach optional keys when present so the signed canonical bytes match
  // what a consumer re-derives from the card it received.
  if (username) {
    card.username = username;
  }
  if (avatarId) {
    card.avatarUrl = `${getAssetCdnUrl()}/${avatarId}`;
  }

  const attestation = signCard(card);
  return signedPublicCardSchema.parse({ card, attestation });
}
