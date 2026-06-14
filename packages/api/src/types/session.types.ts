/**
 * Session Types
 * 
 * Centralized type definitions for session-related operations.
 */

import { ISession } from '../models/Session';
import { DeviceFingerprint } from '../utils/deviceUtils';

export interface SessionValidationResult {
  session: ISession;
  user: any;
  payload: any;
}

export interface SessionCreateOptions {
  deviceName?: string;
  deviceFingerprint?: DeviceFingerprint;
  /**
   * When set, the session's deviceId is derived deterministically from
   * (userId, stableDeviceKey) via `deriveServiceDeviceId` — used for
   * IdP/FedCM-issued sessions so one (user, RP) reuses a single session. The
   * request's IP/UA are NOT used for the deviceId on this path. Real device
   * logins (no stableDeviceKey) are unaffected.
   */
  stableDeviceKey?: string;
}

export interface SessionRefreshResult {
  accessToken: string;
  refreshToken: string;
  session: ISession;
}

