import SecurityActivity, { ISecurityActivity, SecurityEventType, SecurityEventSeverity, SECURITY_EVENT_SEVERITY_MAP } from '../models/SecurityActivity';
import { Request } from 'express';
import { extractDeviceInfo } from '../utils/deviceUtils';
import { logger } from '../utils/logger';
import { Types } from 'mongoose';
import { validatePagination } from '../utils/validation';

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

// Constants for validation and limits
const MAX_EVENT_DESCRIPTION_LENGTH = 500;
const MAX_METADATA_SIZE = 10000; // bytes (approximate JSON size)
const MAX_USER_AGENT_LENGTH = 500;
const DEDUPLICATION_WINDOW_MS = 5000; // 5 seconds - prevent duplicate events

// Field selection for queries (single source of truth)
const ACTIVITY_SELECT_FIELDS = '_id userId eventType eventDescription metadata ipAddress userAgent deviceId timestamp severity createdAt';

class SecurityActivityService {
  /**
   * Sanitize string input to prevent injection attacks
   */
  private sanitizeString(input: string | undefined, maxLength: number): string | undefined {
    if (!input) return undefined;
    // Remove control characters and limit length
    const sanitized = input.replace(/[\x00-\x1F\x7F]/g, '').trim();
    return sanitized.length > maxLength ? sanitized.substring(0, maxLength) : sanitized;
  }

  /**
   * Validate and sanitize metadata
   */
  private sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
    try {
      // Limit metadata size by stringifying and checking length
      const jsonString = JSON.stringify(metadata);
      if (jsonString.length > MAX_METADATA_SIZE) {
        logger.warn('Metadata too large, truncating', {
          component: 'SecurityActivityService',
          originalSize: jsonString.length,
        });
        // Return minimal metadata if too large
        return { truncated: true };
      }
      return metadata;
    } catch (error) {
      logger.warn('Failed to serialize metadata', {
        component: 'SecurityActivityService',
        method: 'sanitizeMetadata',
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * Check for duplicate events within deduplication window
   */
  private async checkDuplicateEvent(
    userId: string,
    eventType: SecurityEventType,
    deviceId?: string,
    windowMs: number = DEDUPLICATION_WINDOW_MS
  ): Promise<boolean> {
    try {
      const windowStart = new Date(Date.now() - windowMs);
      const query: any = {
        userId,
        eventType,
        timestamp: { $gte: windowStart },
      };
      
      // For device-specific events, also check deviceId
      if (deviceId && (eventType === 'sign_in' || eventType === 'device_added' || eventType === 'device_removed')) {
        query.deviceId = deviceId;
      }

      const recentEvent = await SecurityActivity.findOne(query)
        .select('_id')
        .lean();

      return !!recentEvent;
    } catch (error) {
      // If deduplication check fails, allow the event (fail open)
      logger.warn('Failed to check for duplicate event', {
        component: 'SecurityActivityService',
        method: 'checkDuplicateEvent',
        userId,
        eventType,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Log a security event
   * Production-grade implementation with validation, sanitization, and deduplication
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

    // Validate userId is a valid ObjectId
    if (!Types.ObjectId.isValid(userId)) {
      logger.error('Invalid userId provided to logSecurityEvent', new Error('Invalid userId'), {
        component: 'SecurityActivityService',
        method: 'logSecurityEvent',
        userId,
        eventType,
      });
      throw new Error('Invalid userId');
    }

    // Sanitize event description
    let sanitizedDescription = this.sanitizeString(eventDescription, MAX_EVENT_DESCRIPTION_LENGTH);
    if (!sanitizedDescription || sanitizedDescription.length === 0) {
      logger.warn('Empty event description after sanitization', {
        component: 'SecurityActivityService',
        userId,
        eventType,
      });
      // Use default description if sanitization removed everything
      sanitizedDescription = `Security event: ${eventType}`;
    }

    // Extract and sanitize IP address and user agent
    const rawIpAddress = req?.ip || req?.socket?.remoteAddress || undefined;
    const ipAddress = rawIpAddress ? this.sanitizeString(rawIpAddress, 45) : undefined; // IPv6 max length is 45 chars
    const rawUserAgent = req?.headers['user-agent'];
    const userAgent = rawUserAgent ? this.sanitizeString(rawUserAgent, MAX_USER_AGENT_LENGTH) : undefined;

    // Sanitize metadata
    const sanitizedMetadata = this.sanitizeMetadata(metadata);

    // Extract device info from request if available and not already in metadata
    let finalDeviceId = deviceId;
    if (req && !finalDeviceId) {
      const deviceInfo = extractDeviceInfo(req);
      finalDeviceId = deviceInfo.deviceId;
      if (!sanitizedMetadata.deviceName && deviceInfo.deviceName) {
        sanitizedMetadata.deviceName = this.sanitizeString(deviceInfo.deviceName, 100);
      }
      if (!sanitizedMetadata.deviceType && deviceInfo.deviceType) {
        sanitizedMetadata.deviceType = this.sanitizeString(deviceInfo.deviceType, 50);
      }
      if (!sanitizedMetadata.platform && deviceInfo.platform) {
        sanitizedMetadata.platform = this.sanitizeString(deviceInfo.platform, 50);
      }
    }

    // Check for duplicate events (prevent spam/rapid duplicate logging)
    const isDuplicate = await this.checkDuplicateEvent(userId, eventType, finalDeviceId);
    if (isDuplicate) {
      logger.debug('Duplicate security event detected, skipping', {
        component: 'SecurityActivityService',
        userId,
        eventType,
        deviceId: finalDeviceId,
      });
      // Return a placeholder to maintain API contract, but don't save duplicate
      return {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(userId),
        eventType,
        eventDescription: sanitizedDescription,
        metadata: sanitizedMetadata,
        ipAddress,
        userAgent,
        deviceId: finalDeviceId,
        timestamp: new Date(),
        severity,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ISecurityActivity;
    }

    const activity = new SecurityActivity({
      userId,
      eventType,
      eventDescription: sanitizedDescription,
      metadata: sanitizedMetadata,
      ipAddress,
      userAgent,
      deviceId: finalDeviceId,
      timestamp: new Date(),
      severity,
    });

    try {
      const savedActivity = await activity.save();
      
      // Log successful event creation for monitoring (only for high-severity events to reduce noise)
      if (severity === 'high' || severity === 'critical') {
        logger.info('Security event logged', {
          component: 'SecurityActivityService',
          userId,
          eventType,
          severity,
          activityId: savedActivity._id.toString(),
        });
      }
      
      return savedActivity;
    } catch (error) {
      // Log error but don't throw - security logging should never break main operations
      // However, for critical events, we should be more aggressive about retrying
      logger.error('Failed to log security event', error instanceof Error ? error : new Error(String(error)), {
        component: 'SecurityActivityService',
        method: 'logSecurityEvent',
        userId,
        eventType,
        severity,
      });
      
      // For critical events, attempt one retry after a short delay
      if (severity === 'critical') {
        try {
          await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
          const retryActivity = await activity.save();
          logger.info('Critical security event logged on retry', {
            component: 'SecurityActivityService',
            userId,
            eventType,
            activityId: retryActivity._id.toString(),
          });
          return retryActivity;
        } catch (retryError) {
          logger.error('Retry failed for critical security event', retryError instanceof Error ? retryError : new Error(String(retryError)), {
            component: 'SecurityActivityService',
            userId,
            eventType,
          });
        }
      }
      
      // Return the activity object even if save failed (non-critical operation)
      return activity;
    }
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
    // Validate userId
    if (!Types.ObjectId.isValid(userId)) {
      throw new Error('Invalid userId');
    }

    // Use shared validation utility for pagination
    const { limit, offset } = validatePagination(
      options.limit,
      options.offset,
      100, // maxLimit
      50   // defaultLimit
    );

    const { eventType } = options;

    const query: any = { userId };
    if (eventType) {
      query.eventType = eventType;
    }

    // Select only needed fields for better performance and memory efficiency
    const [activities, total] = await Promise.all([
      SecurityActivity.find(query)
        .select(ACTIVITY_SELECT_FIELDS)
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
    // Validate userId
    if (!Types.ObjectId.isValid(userId)) {
      throw new Error('Invalid userId');
    }

    // Validate and clamp limit
    const validatedLimit = Math.min(Math.max(1, limit), 100);

    // Select only needed fields for better performance
    const activities = await SecurityActivity.find({ userId })
      .select(ACTIVITY_SELECT_FIELDS)
      .sort({ timestamp: -1 })
      .limit(validatedLimit)
      .lean();

    return activities as unknown as ISecurityActivity[];
  }

  /**
   * Get default severity for event type
   */
  private getDefaultSeverity(eventType: SecurityEventType): SecurityEventSeverity {
    return SECURITY_EVENT_SEVERITY_MAP[eventType] || 'low';
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

  /**
   * Helper: Log private key export event
   */
  async logPrivateKeyExported(
    userId: string,
    req?: Request,
    deviceId?: string
  ): Promise<ISecurityActivity> {
    return this.logSecurityEvent({
      userId,
      eventType: 'private_key_exported',
      eventDescription: 'Private key exported',
      metadata: {
        exportMethod: 'printed',
      },
      req,
      deviceId,
      severity: 'high',
    });
  }

  /**
   * Helper: Log backup created event
   */
  async logBackupCreated(
    userId: string,
    req?: Request,
    deviceId?: string
  ): Promise<ISecurityActivity> {
    return this.logSecurityEvent({
      userId,
      eventType: 'backup_created',
      eventDescription: 'Encrypted backup file created',
      metadata: {
        backupType: 'encrypted_zip',
      },
      req,
      deviceId,
      severity: 'high',
    });
  }
}

export default new SecurityActivityService();

