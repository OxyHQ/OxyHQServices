import { OxyServices } from '../OxyServices';
import {
  DeviceSession,
  DeviceSessionsResponse,
  DeviceSessionLogoutResponse,
  UpdateDeviceNameResponse
} from '../../models/interfaces';
import { buildSearchParams } from '../../utils/apiUtils';

/**
 * Device service for handling device session management
 */
export class DeviceService extends OxyServices {
  /**
   * Get device sessions
   */
  async getDeviceSessions(sessionId: string, deviceId?: string): Promise<DeviceSession[]> {
    try {
      const params = { deviceId };
      const searchParams = buildSearchParams(params);
      
      const res = await this.getClient().get(`/devices/sessions/${sessionId}?${searchParams.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout from all device sessions
   */
  async logoutAllDeviceSessions(sessionId: string, deviceId?: string, excludeCurrent?: boolean): Promise<DeviceSessionLogoutResponse> {
    try {
      const params = { deviceId, excludeCurrent };
      const searchParams = buildSearchParams(params);
      
      const res = await this.getClient().delete(`/devices/sessions/${sessionId}/logout-all?${searchParams.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update device name
   */
  async updateDeviceName(sessionId: string, deviceName: string): Promise<UpdateDeviceNameResponse> {
    try {
      const res = await this.getClient().put(`/devices/sessions/${sessionId}/name`, { deviceName });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
} 