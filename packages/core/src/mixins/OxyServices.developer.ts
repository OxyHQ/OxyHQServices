/**
 * Developer API Methods Mixin
 * 
 * Provides methods for managing developer applications and API keys
 */
import type { OxyServicesBase } from '../OxyServices.base';
import { CACHE_TIMES } from './mixinHelpers';

export function OxyServicesDeveloperMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Get developer apps for the current user
     * @returns Array of developer apps
     */
    async getDeveloperApps(): Promise<any[]> {
      try {
        const res = await this.makeRequest<{ apps?: any[] }>('GET', '/developer/apps', undefined, {
          cache: true,
          cacheTTL: CACHE_TIMES.MEDIUM,
        });
        return res.apps || [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Create a new developer app
     * @param data - Developer app configuration
     * @returns Created developer app
     */
    async createDeveloperApp(data: {
      name: string;
      description?: string;
      webhookUrl: string;
      devWebhookUrl?: string;
      scopes?: string[];
    }): Promise<any> {
      try {
        const res = await this.makeRequest<{ app: any }>('POST', '/developer/apps', data, { cache: false });
        return res.app;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get a specific developer app
     */
    async getDeveloperApp(appId: string): Promise<any> {
      try {
      const res = await this.makeRequest<{ app: any }>('GET', `/developer/apps/${appId}`, undefined, {
        cache: true,
        cacheTTL: CACHE_TIMES.LONG,
      });
        return res.app;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Update a developer app
     * @param appId - The developer app ID
     * @param data - Updated app configuration
     * @returns Updated developer app
     */
    async updateDeveloperApp(appId: string, data: {
      name?: string;
      description?: string;
      webhookUrl?: string;
      devWebhookUrl?: string;
      scopes?: string[];
    }): Promise<any> {
      try {
        const res = await this.makeRequest<{ app: any }>('PATCH', `/developer/apps/${appId}`, data, { cache: false });
        return res.app;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Regenerate API secret for a developer app
     * @param appId - The developer app ID
     * @returns App with new secret
     */
    async regenerateDeveloperAppSecret(appId: string): Promise<any> {
      try {
        return await this.makeRequest('POST', `/developer/apps/${appId}/regenerate-secret`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Delete a developer app
     * @param appId - The developer app ID
     * @returns Deletion result
     */
    async deleteDeveloperApp(appId: string): Promise<any> {
      try {
        return await this.makeRequest('DELETE', `/developer/apps/${appId}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

