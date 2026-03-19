/**
 * Topics Methods Mixin
 *
 * Provides methods for topic discovery and management
 */
import type { OxyServicesBase } from '../OxyServices.base';
import type { TopicData, TopicTranslation } from '../models/Topic';
import { CACHE_TIMES } from './mixinHelpers';

export function OxyServicesTopicsMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Get top-level topic categories
     * @param locale - Optional locale for translated results
     * @returns List of category topics
     */
    async getTopicCategories(locale?: string): Promise<TopicData[]> {
      try {
        const params: Record<string, string> = {};
        if (locale) params.locale = locale;
        return await this.makeRequest('GET', '/topics/categories', params, {
          cache: true,
          cacheTTL: CACHE_TIMES.EXTRA_LONG,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Search topics by query string
     * @param query - Search query
     * @param limit - Optional result limit
     * @returns Matching topics
     */
    async searchTopics(query: string, limit?: number): Promise<TopicData[]> {
      try {
        const params: Record<string, string | number> = { q: query };
        if (limit) params.limit = limit;
        return await this.makeRequest('GET', '/topics/search', params, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * List topics with optional filters
     * @param options - Filter and pagination options
     * @returns List of topics
     */
    async listTopics(options?: {
      type?: string;
      q?: string;
      limit?: number;
      offset?: number;
      locale?: string;
    }): Promise<TopicData[]> {
      try {
        const params: Record<string, string | number> = {};
        if (options?.type) params.type = options.type;
        if (options?.q) params.q = options.q;
        if (options?.limit) params.limit = options.limit;
        if (options?.offset) params.offset = options.offset;
        if (options?.locale) params.locale = options.locale;
        return await this.makeRequest('GET', '/topics', params, {
          cache: true,
          cacheTTL: CACHE_TIMES.SHORT,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get a single topic by slug
     * @param slug - Topic slug
     * @returns Topic data
     */
    async getTopicBySlug(slug: string): Promise<TopicData> {
      try {
        return await this.makeRequest('GET', `/topics/${slug}`, undefined, {
          cache: true,
          cacheTTL: CACHE_TIMES.LONG,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Resolve an array of topic names to existing or newly created topics
     * @param names - Array of { name, type } objects to resolve
     * @returns Resolved topic data
     */
    async resolveTopicNames(
      names: Array<{ name: string; type: string }>
    ): Promise<TopicData[]> {
      try {
        return await this.makeRequest('POST', '/topics/resolve', { names }, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Update metadata for a topic
     * @param slug - Topic slug
     * @param data - Metadata fields to update
     * @returns Updated topic data
     */
    async updateTopicMetadata(
      slug: string,
      data: {
        description?: string;
        translations?: Record<string, TopicTranslation>;
      }
    ): Promise<TopicData> {
      try {
        return await this.makeRequest('PATCH', `/topics/${slug}`, data, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}
