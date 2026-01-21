import { Request } from 'express';
import Session from '../models/Session';
import { logger } from '../utils/logger';
import securityActivityService from './securityActivityService';

/**
 * Anomaly Detection Service
 * Detects suspicious login patterns and unusual account activity
 */
class AnomalyDetectionService {
  /**
   * Calculate distance between two coordinates in kilometers
   * Uses Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Detect if login is from a new location
   * Returns true if location is suspiciously far from previous locations
   * NOTE: Currently disabled - location field is stored as string, not coordinates object
   */
  async detectNewLocation(
    userId: string,
    currentLocation?: { lat: number; lon: number }
  ): Promise<{ isAnomaly: boolean; reason?: string; distance?: number }> {
    // Location-based detection disabled until Session model is updated to store coordinates
    return { isAnomaly: false };
  }

  /**
   * Detect if login is from a new device
   */
  async detectNewDevice(
    userId: string,
    deviceInfo: any
  ): Promise<{ isAnomaly: boolean; reason?: string }> {
    if (!deviceInfo) {
      return { isAnomaly: false };
    }

    try {
      // Check if this device fingerprint has been seen before
      const existingSession = await Session.findOne({
        userId,
        'deviceInfo.fingerprint': deviceInfo.fingerprint,
      }).lean();

      if (!existingSession) {
        return {
          isAnomaly: true,
          reason: 'Login from new device',
        };
      }

      return { isAnomaly: false };
    } catch (error) {
      logger.error('Error detecting new device:', error);
      return { isAnomaly: false };
    }
  }

  /**
   * Detect impossible travel
   * Two logins from different locations within time that's impossible to travel
   * NOTE: Currently disabled - location field is stored as string, not coordinates object
   */
  async detectImpossibleTravel(
    userId: string,
    currentLocation?: { lat: number; lon: number }
  ): Promise<{ isAnomaly: boolean; reason?: string; details?: string }> {
    // Impossible travel detection disabled until Session model is updated to store coordinates
    return { isAnomaly: false };
  }

  /**
   * Detect rapid login attempts from different IPs
   */
  async detectRapidIPChanges(
    userId: string,
    currentIp: string
  ): Promise<{ isAnomaly: boolean; reason?: string }> {
    try {
      // Get sessions from last hour
      const recentSessions = await Session.find({
        userId,
        createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) },
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      const uniqueIps = new Set<string>();
      recentSessions.forEach(session => {
        if (session.deviceInfo?.ipAddress) {
          uniqueIps.add(session.deviceInfo.ipAddress);
        }
      });

      // If more than 3 different IPs in last hour
      if (uniqueIps.size > 3 && !uniqueIps.has(currentIp)) {
        return {
          isAnomaly: true,
          reason: 'Multiple IPs detected in short time',
        };
      }

      return { isAnomaly: false };
    } catch (error) {
      logger.error('Error detecting rapid IP changes:', error);
      return { isAnomaly: false };
    }
  }

  /**
   * Run all anomaly checks and alert if suspicious
   */
  async checkForAnomalies(
    userId: string,
    req: Request
  ): Promise<{
    hasAnomalies: boolean;
    anomalies: Array<{ type: string; reason: string; details?: string }>;
  }> {
    const anomalies: Array<{ type: string; reason: string; details?: string }> = [];

    const deviceInfo = (req as any).deviceInfo;
    const location = deviceInfo?.location?.coordinates;

    // Run all detection checks in parallel
    const [newLocation, newDevice, impossibleTravel, rapidIP] = await Promise.all([
      this.detectNewLocation(userId, location),
      this.detectNewDevice(userId, deviceInfo),
      this.detectImpossibleTravel(userId, location),
      this.detectRapidIPChanges(userId, req.ip || ''),
    ]);

    if (newLocation.isAnomaly) {
      anomalies.push({
        type: 'new_location',
        reason: newLocation.reason!,
        details: `${newLocation.distance}km from usual locations`,
      });
    }

    if (newDevice.isAnomaly) {
      anomalies.push({
        type: 'new_device',
        reason: newDevice.reason!,
      });
    }

    if (impossibleTravel.isAnomaly) {
      anomalies.push({
        type: 'impossible_travel',
        reason: impossibleTravel.reason!,
        details: impossibleTravel.details,
      });
    }

    if (rapidIP.isAnomaly) {
      anomalies.push({
        type: 'rapid_ip_change',
        reason: rapidIP.reason!,
      });
    }

    // Log suspicious activity if anomalies detected
    if (anomalies.length > 0) {
      await securityActivityService.logSecurityEvent({
        userId,
        eventType: 'suspicious_activity',
        eventDescription: 'Suspicious activity detected during login',
        metadata: {
          anomalies,
          deviceInfo,
        },
        req,
        severity: 'critical',
      });

      logger.warn('Anomalies detected for user login', {
        userId,
        anomalies,
      });
    }

    return {
      hasAnomalies: anomalies.length > 0,
      anomalies,
    };
  }
}

export default new AnomalyDetectionService();
