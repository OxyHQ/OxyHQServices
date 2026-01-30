/**
 * Device Methods Mixin
 */
import type { OxyServicesBase } from '../OxyServices.base';

export function OxyServicesDevicesMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Register a new device
     * @param deviceData - Device information
     * @returns Registered device object
     */
    async registerDevice(deviceData: any): Promise<any> {
      try {
        return await this.makeRequest('POST', '/api/devices', deviceData, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get all devices for the current user
     * @returns Array of user devices
     */
    async getUserDevices(): Promise<any[]> {
      try {
        return await this.makeRequest('GET', '/api/devices', undefined, {
          cache: false, // Don't cache device list - always get fresh data
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Remove a device
     * @param deviceId - The device ID to remove
     */
    async removeDevice(deviceId: string): Promise<void> {
      try {
        await this.makeRequest('DELETE', `/api/devices/${deviceId}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get device sessions for a given session ID
     * Note: Not cached by default to ensure fresh data
     * @param sessionId - The session ID
     * @returns Array of device sessions
     */
    async getDeviceSessions(sessionId: string): Promise<any[]> {
      try {
        // Use makeRequest for consistent error handling and optional caching
        // Cache disabled by default to ensure fresh session data
        return await this.makeRequest<any[]>('GET', `/api/session/device/sessions/${sessionId}`, undefined, {
          cache: false, // Don't cache sessions - always get fresh data
          deduplicate: true, // Deduplicate concurrent requests for same sessionId
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Logout all device sessions
     * @param sessionId - The session ID
     * @param deviceId - Optional device ID to target
     * @param excludeCurrent - Whether to exclude the current session
     * @returns Logout result
     */
    async logoutAllDeviceSessions(sessionId: string, deviceId?: string, excludeCurrent?: boolean): Promise<any> {
      try {
        const urlParams: any = {};
        if (deviceId) urlParams.deviceId = deviceId;
        if (excludeCurrent) urlParams.excludeCurrent = 'true';
        return await this.makeRequest('POST', `/api/session/device/logout-all/${sessionId}`, urlParams, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Update device name
     * @param sessionId - The session ID
     * @param deviceName - New device name
     * @returns Updated device object
     */
    async updateDeviceName(sessionId: string, deviceName: string): Promise<any> {
      try {
        return await this.makeRequest('PUT', `/api/session/device/name/${sessionId}`, { deviceName }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get security information
     * @returns Security information object
     */
    async getSecurityInfo(): Promise<{
      recoveryEmail: string | null;
    }> {
      try {
        return await this.makeRequest('GET', '/api/devices/security', undefined, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

