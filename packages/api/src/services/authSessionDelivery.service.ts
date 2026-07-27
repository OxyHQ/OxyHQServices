/**
 * Automatic delivery of a pending authorization request to the approving
 * identity's own vault installs, plus the delivery-progress bookkeeping that
 * goes with it.
 *
 * Two rules define this module's security posture:
 *
 *  1. **The target user is NEVER derived from the request.** The caller passes
 *     the identity resolved from a bearer token, and delivery targets that
 *     user's OWN installs and nothing else. A push is therefore impossible to
 *     trigger from a username or email typed into an unauthenticated browser.
 *  2. **Eligibility is registry-based.** Only installs registered by an
 *     `Application` carrying the {@link IDENTITY_APPROVAL_CAPABILITY} staff-only
 *     capability are targeted — never a hardcoded client id, bundle id or app
 *     name.
 *
 * Zero eligible installs is a NORMAL outcome (the client falls back to a QR),
 * not an error, and a push transport failure degrades to exactly the same
 * outcome — delivery must never fail the auth flow.
 */

import type mongoose from 'mongoose';
import { AuthSession } from '../models/AuthSession';
import { Application } from '../models/Application';
import { PushToken } from '../models/PushToken';
import { pushService } from './push.service';
import { IDENTITY_APPROVAL_CAPABILITY } from '../utils/applicationCapabilities';
// The Android channel the approval push is sent on. NOT an iOS `categoryId`:
// the notification carries no action buttons, so it can only be opened (which
// routes into the normal in-vault approval screen) or dismissed. It is a wire
// contract because the vault must create a channel with this exact id before a
// push can land — Android 8+ drops a notification whose channel it does not
// know, silently and with no error on either side.
import { IDENTITY_APPROVAL_PUSH_CHANNEL } from '@oxyhq/contracts';
import { logger } from '../utils/logger';

/** Runtime type discriminator of the push payload, mirrored by the vault. */
export const IDENTITY_APPROVAL_PUSH_TYPE = 'oxy_commons_auth_request';

/**
 * Static notification copy. Deliberately carries NO request-derived data — not
 * the application name, not the origin, not the account. The vault re-fetches
 * the authoritative application / scopes / origin / expiry from
 * `GET /auth/session/approve-info/:authorizeCode` after the user opens it.
 */
const PUSH_TITLE = 'Sign-in request';
const PUSH_BODY = 'Open Commons to review this request.';

/**
 * The ONLY payload delivered. Exactly two fields: a type discriminator and the
 * deep link carrying the PUBLIC approval handle. No display data (which would be
 * untrusted at the receiver anyway) and no secrets — never the `sessionToken`.
 */
export type IdentityApprovalPushPayload = {
  type: typeof IDENTITY_APPROVAL_PUSH_TYPE;
  approvalUrl: string;
};

export function buildApprovalUrl(authorizeCode: string): string {
  return `oxycommons://approve?v=1&code=${encodeURIComponent(authorizeCode)}`;
}

export type DeliverAuthRequestOutcome =
  | {
      ok: true;
      /** Secret channel of the waiting originator — for the socket wake ONLY. */
      sessionToken: string;
      /** At least one install accepted the push. */
      delivered: boolean;
      /** How many eligible installs were targeted. A COUNT — never PII. */
      targets: number;
    }
  | { ok: false; status: 400 | 404; message: string };

/**
 * Resolve the push tokens of the user's installs that may approve an identity
 * request. Returns an empty array when the user has no such install, or when no
 * application currently carries the capability at all.
 */
async function resolveIdentityApprovalTokens(userId: string): Promise<string[]> {
  const capableApps = await Application.find({
    status: 'active',
    capabilities: IDENTITY_APPROVAL_CAPABILITY,
  })
    .select('_id')
    .lean<{ _id: mongoose.Types.ObjectId }[]>();

  if (capableApps.length === 0) {
    return [];
  }

  const installs = await PushToken.find({
    userId,
    applicationId: { $in: capableApps.map((app) => app._id) },
  })
    .select('token')
    .lean<{ token: string }[]>();

  return installs.map((install) => install.token);
}

/**
 * Push a PENDING authorization request to the authenticated identity's own
 * approval-capable installs.
 *
 * @param authorizeCode  Public approval handle of the request.
 * @param identityUserId The AUTHENTICATED user — the sole delivery target.
 */
export async function deliverAuthRequestToIdentityApps(params: {
  authorizeCode: string;
  identityUserId: string;
}): Promise<DeliverAuthRequestOutcome> {
  const { authorizeCode, identityUserId } = params;

  const authSession = await AuthSession.findOne({ authorizeCode });
  if (!authSession) {
    return { ok: false, status: 404, message: 'Auth session not found' };
  }

  if (authSession.expiresAt.getTime() <= Date.now()) {
    // Same lazy expiry the sibling approval endpoints perform. Conditioned on
    // `pending` so a concurrent approval is never overwritten.
    await AuthSession.updateOne(
      { authorizeCode, status: 'pending' },
      { $set: { status: 'expired' } },
    );
    return { ok: false, status: 400, message: 'Auth session has expired' };
  }

  if (authSession.status !== 'pending') {
    return { ok: false, status: 400, message: 'Auth session is no longer pending' };
  }

  const tokens = await resolveIdentityApprovalTokens(identityUserId);
  if (tokens.length === 0) {
    // Normal: this identity has no vault install on any device. The client falls
    // back to the QR / deep-link surfaces.
    return { ok: true, sessionToken: authSession.sessionToken, delivered: false, targets: 0 };
  }

  const payload: IdentityApprovalPushPayload = {
    type: IDENTITY_APPROVAL_PUSH_TYPE,
    approvalUrl: buildApprovalUrl(authorizeCode),
  };

  let accepted = 0;
  try {
    const dispatched = await pushService.sendPushToTokens({
      userId: identityUserId,
      tokens,
      title: PUSH_TITLE,
      body: PUSH_BODY,
      channelId: IDENTITY_APPROVAL_PUSH_CHANNEL,
      data: payload,
    });
    accepted = dispatched.accepted;
  } catch (err) {
    // The push service already swallows its own transport errors; this is the
    // belt-and-braces guard that keeps a delivery problem from ever surfacing as
    // an auth failure. The client simply falls back.
    logger.warn('[AuthSession] Identity approval push failed', {
      authorizeCode: authorizeCode.substring(0, 8) + '...',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const delivered = accepted > 0;

  if (delivered) {
    // Progress is a TIMESTAMP, never a status — the state machine is untouched.
    // Recorded once, and only while the request is still pending.
    await AuthSession.updateOne(
      { authorizeCode, status: 'pending', pushSentAt: null },
      { $set: { pushSentAt: new Date() } },
    );
  }

  return {
    ok: true,
    sessionToken: authSession.sessionToken,
    delivered,
    targets: tokens.length,
  };
}

export type MarkAuthRequestOpenedOutcome =
  | {
      ok: true;
      /** Secret channel of the waiting originator — for the socket wake ONLY. */
      sessionToken: string;
      /** True only on the FIRST record; a repeat call is a no-op. */
      recorded: boolean;
    }
  | { ok: false; status: 404; message: string };

/**
 * Record that the approval surface opened a PENDING request.
 *
 * Idempotent (`openedAt` is written at most once) and pending-only, via a single
 * conditional update: it can never move `status`, revive an expired request, or
 * overwrite an earlier timestamp.
 */
export async function markAuthRequestOpened(
  authorizeCode: string,
): Promise<MarkAuthRequestOpenedOutcome> {
  const authSession = await AuthSession.findOne({ authorizeCode });
  if (!authSession) {
    return { ok: false, status: 404, message: 'Auth session not found' };
  }

  const update = await AuthSession.updateOne(
    {
      authorizeCode,
      status: 'pending',
      openedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { openedAt: new Date() } },
  );

  return {
    ok: true,
    sessionToken: authSession.sessionToken,
    recorded: (update.modifiedCount ?? 0) > 0,
  };
}
