/**
 * TOTP Enrollment Methods Mixin
 */
import type { OxyServicesBase } from '../OxyServices.base';

export function OxyServicesTotpMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
    async startTotpEnrollment(sessionId: string): Promise<{ secret: string; otpauthUrl: string; issuer: string; label: string }> {
      try {
        return await this.makeRequest('POST', '/api/auth/totp/enroll/start', { sessionId }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async verifyTotpEnrollment(sessionId: string, code: string): Promise<{ enabled: boolean; backupCodes?: string[]; recoveryKey?: string }> {
      try {
        return await this.makeRequest('POST', '/api/auth/totp/enroll/verify', { sessionId, code }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async disableTotp(sessionId: string, code: string): Promise<{ disabled: boolean }> {
      try {
        return await this.makeRequest('POST', '/api/auth/totp/disable', { sessionId, code }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

