import SecurityActivity, { ISecurityActivity, SecurityEventType, SecurityEventSeverity } from '../models/SecurityActivity';
import { Request } from 'express';
import { extractDeviceInfo } from '../utils/deviceUtils';

export interface SecurityEventMetadata {
  [key: string]: any;
  deviceName?: string;
  deviceType?: string;
  platform?: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
}

export interface LogSecurityEventOptions {
  userId: string;
  eventType: SecurityEventType;
  eventDescription: string;
  metadata?: SecurityEventMetadata;
  req?: Request;
  severity?: SecurityEventSeverity;
  deviceId?: string;
}

class SecurityActivityService {
  /**
   * Log a security event
   */
  async logSecurityEvent(options: LogSecurityEventOptions): Promise<ISecurityActivity> {
    const {
      userId,
      eventType,
      eventDescription,
      metadata = {},
      req,
      severity = this.getDefaultSeverity(eventType),
      deviceId,
    } = options;

    // Extract IP address and user agent from request if available
    const ipAddress = req?.ip || req?.socket?.remoteAddress || undefined;
    const userAgent = req?.headers['user-agent'] || undefined;

    // Extract device info from request if available and not already in metadata
    let finalDeviceId = deviceId;
    if (req && !finalDeviceId) {
      const deviceInfo = extractDeviceInfo(req);
      finalDeviceId = deviceInfo.deviceId;
      if (!metadata.deviceName && deviceInfo.deviceName) {
        metadata.deviceName = deviceInfo.deviceName;
      }
      if (!metadata.deviceType && deviceInfo.deviceType) {
        metadata.deviceType = deviceInfo.deviceType;
      }
      if (!metadata.platform && deviceInfo.platform) {
        metadata.platform = deviceInfo.platform;
      }
    }

    const activity = new SecurityActivity({
      userId,
      eventType,
      eventDescription,
      metadata,
      ipAddress,
      userAgent,
      deviceId: finalDeviceId,
      timestamp: new Date(),
      severity,
    });

    return await activity.save();
  }

  /**
   * Get user's security activity with pagination
   */
  async getUserSecurityActivity(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      eventType?: SecurityEventType;
    } = {}
  ): Promise<{ activities: ISecurityActivity[]; total: number; hasMore: boolean }> {
    const { limit = 50, offset = 0, eventType } = options;

    const query: any = { userId };
    if (eventType) {
      query.eventType = eventType;
    }

    const [activities, total] = await Promise.all([
      SecurityActivity.find(query)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      SecurityActivity.countDocuments(query),
    ]);

    return {
      activities: activities as unknown as ISecurityActivity[],
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Get recent security activity (last N events)
   */
  async getRecentSecurityActivity(
    userId: string,
    limit: number = 10
  ): Promise<ISecurityActivity[]> {
    const activities = await SecurityActivity.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    return activities as unknown as ISecurityActivity[];
  }

  /**
   * Get default severity for event type
   */
  private getDefaultSeverity(eventType: SecurityEventType): SecurityEventSeverity {
    switch (eventType) {
      case 'sign_in':
      case 'sign_out':
      case 'profile_updated':
        return 'low';
      case 'email_changed':
      case 'device_added':
      case 'device_removed':
      case 'security_settings_changed':
        return 'medium';
      case 'account_recovery':
        return 'high';
      case 'suspicious_activity':
        return 'critical';
      default:
        return 'low';
    }
  }

  /**
   * Helper: Log sign-in event
   */
  async logSignIn(
    userId: string,
    req: Request,
    deviceId?: string,
    metadata?: SecurityEventMetadata
  ): Promise<ISecurityActivity> {
    return this.logSecurityEvent({
      userId,
      eventType: 'sign_in',
      eventDescription: 'User signed in',
      metadata,
      req,
      deviceId,
      severity: 'low',
    });
  }

  /**
   * Helper: Log sign-out event
   */
  async logSignOut(
    userId: string,
    req: Request,
    deviceId?: string
  ): Promise<ISecurityActivity> {
    return this.logSecurityEvent({
      userId,
      eventType: 'sign_out',
      eventDescription: 'User signed out',
      req,
      deviceId,
      severity: 'low',
    });
  }

  /**
   * Helper: Log email change event
   */
  async logEmailChange(
    userId: string,
    oldEmail: string,
    newEmail: string,
    req?: Request
  ): Promise<ISecurityActivity> {
    return this.logSecurityEvent({
      userId,
      eventType: 'email_changed',
      eventDescription: `Email changed from ${oldEmail} to ${newEmail}`,
      metadata: {
        oldValue: oldEmail,
        newValue: newEmail,
      },
      req,
      severity: 'medium',
    });
  }

  /**
   * Helper: Log profile update event
   */
  async logProfileUpdate(
    userId: string,
    updatedFields: string[],
    req?: Request
  ): Promise<ISecurityActivity> {
    return this.logSecurityEvent({
      userId,
      eventType: 'profile_updated',
      eventDescription: `Profile updated: ${updatedFields.join(', ')}`,
      metadata: {
        updatedFields,
      },
      req,
      severity: 'low',
    });
  }

  /**
   * Helper: Log device added event
   */
  async logDeviceAdded(
    userId: string,
    deviceId: string,
    deviceName: string,
    req?: Request
  ): Promise<ISecurityActivity> {
    return this.logSecurityEvent({
      userId,
      eventType: 'device_added',
      eventDescription: `New device added: ${deviceName}`,
      metadata: {
        deviceName,
      },
      req,
      deviceId,
      severity: 'medium',
    });
  }

  /**
   * Helper: Log device removed event
   */
  async logDeviceRemoved(
    userId: string,
    deviceId: string,
    deviceName: string,
    req?: Request
  ): Promise<ISecurityActivity> {
    return this.logSecurityEvent({
      userId,
      eventType: 'device_removed',
      eventDescription: `Device removed: ${deviceName}`,
      metadata: {
        deviceName,
      },
      req,
      deviceId,
      severity: 'medium',
    });
  }

  /**
   * Helper: Log account recovery event
   */
  async logAccountRecovery(
    userId: string,
    recoveryMethod: string,
    req?: Request
  ): Promise<ISecurityActivity> {
    return this.logSecurityEvent({
      userId,
      eventType: 'account_recovery',
      eventDescription: `Account recovery via ${recoveryMethod}`,
      metadata: {
        recoveryMethod,
      },
      req,
      severity: 'high',
    });
  }

  /**
   * Helper: Log security settings change event
   */
  async logSecuritySettingsChange(
    userId: string,
    settingName: string,
    oldValue: any,
    newValue: any,
    req?: Request
  ): Promise<ISecurityActivity> {
    return this.logSecurityEvent({
      userId,
      eventType: 'security_settings_changed',
      eventDescription: `Security setting changed: ${settingName}`,
      metadata: {
        settingName,
        oldValue: String(oldValue),
        newValue: String(newValue),
      },
      req,
      severity: 'medium',
    });
  }

  /**
   * Helper: Log suspicious activity event
   */
  async logSuspiciousActivity(
    userId: string,
    description: string,
    metadata?: SecurityEventMetadata,
    req?: Request
  ): Promise<ISecurityActivity> {
    return this.logSecurityEvent({
      userId,
      eventType: 'suspicious_activity',
      eventDescription: description,
      metadata,
      req,
      severity: 'critical',
    });
  }
}

export default new SecurityActivityService();

