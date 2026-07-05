/**
 * Session Types
 * 
 * Centralized type definitions for session-related operations.
 */

import type { ISession } from '../models/Session';
import type { DeviceFingerprintInput } from '../utils/deviceUtils';

export interface SessionValidationResult {
  session: ISession;
  user: any;
  payload: any;
}

export interface SessionCreateOptions {
  deviceName?: string;
  deviceFingerprint?: DeviceFingerprintInput;
  /**
   * When set, the session's deviceId is derived deterministically from
   * (userId, stableDeviceKey) via `deriveServiceDeviceId` so one (user, RP)
   * reuses a single session, independent of request IP/UA. Originally added
   * for IdP/FedCM-issued sessions; no current call site passes this option
   * post-wave-2 (kept for any future server-minted-session caller that needs
   * the same stable-per-RP-session property). Real device logins (no
   * stableDeviceKey) are unaffected.
   */
  stableDeviceKey?: string;
  /**
   * An explicit central deviceId, used verbatim (bypasses stableDeviceKey/UA-IP
   * derivation). Precedence: deviceId > stableDeviceKey > UA/IP > random.
   */
  deviceId?: string;
  /**
   * The OPERATOR user id when this session is minted by switching INTO a managed
   * account (`userId` = the managed account). Recorded on the session for audit
   * and to bind its validity to the operator's `account:act_as` membership.
   */
  operatedByUserId?: string;
}

export interface SessionRefreshResult {
  accessToken: string;
  refreshToken: string;
  session: ISession;
}

