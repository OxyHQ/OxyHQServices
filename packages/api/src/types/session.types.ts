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
}

export interface SessionRefreshResult {
  accessToken: string;
  refreshToken: string;
  session: ISession;
}

