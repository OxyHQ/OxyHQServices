import type {
  ApplicationCredentialStatus,
  IApplicationCredential,
} from '../models/ApplicationCredential';

/**
 * Predicate: may this credential currently be used to authenticate?
 *
 * A credential is usable when:
 *  - it is `active`, OR it is `deprecated` (rotated within its grace window); AND
 *  - it has no `expiresAt`, or `expiresAt` is still in the future.
 *
 * `revoked` credentials are NEVER usable. `deprecated` credentials remain usable
 * only until their grace `expiresAt` elapses (set during rotation). This is the
 * single source of truth shared by every credential-resolution site (OAuth
 * authorize/token, service-token mint) — do not duplicate the predicate.
 *
 * Pure (no Mongoose dependency) so it is trivially unit-testable and importable
 * without loading the Mongoose schema.
 */
export function isCredentialUsable(
  credential: { status: ApplicationCredentialStatus; expiresAt?: Date | null }
): boolean {
  if (credential.status === 'revoked') {
    return false;
  }
  if (credential.status !== 'active' && credential.status !== 'deprecated') {
    return false;
  }
  if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
    return false;
  }
  return true;
}

export type { IApplicationCredential };
