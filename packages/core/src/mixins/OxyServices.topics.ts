/**
 * Topics Methods Mixin
 *
 * Provides methods for topic discovery and management
 */
import type { OxyServicesBase } from '../OxyServices.base';
import type { TopicData, TopicListResult, TopicTranslation } from '../models/Topic';
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
        // `GET /topics/categories` returns `{ categories: TopicData[] }` — the
        // SDK's `unwrapResponse` only unwraps `{ data }`, so unwrap here.
        const response = await this.makeRequest<{ categories: TopicData[] }>(
          'GET',
          '/topics/categories',
          params,
          { cache: true, cacheTTL: CACHE_TIMES.EXTRA_LONG }
        );
        return response.categories ?? [];
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
        // `GET /topics/search` returns `{ topics: TopicData[] }` — unwrap it.
        const response = await this.makeRequest<{ topics: TopicData[] }>(
          'GET',
          '/topics/search',
          params,
          { cache: false }
        );
        return response.topics ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * List topics with optional filters
     * @param options - Filter and pagination options
     * @returns Paginated topics envelope (`topics` plus `total`/`limit`/`offset`)
     */
    async listTopics(options?: {
      type?: string;
      q?: string;
      limit?: number;
      offset?: number;
      locale?: string;
    }): Promise<TopicListResult> {
      try {
        const params: Record<string, string | number> = {};
        if (options?.type) params.type = options.type;
        if (options?.q) params.q = options.q;
        if (options?.limit) params.limit = options.limit;
        if (options?.offset) params.offset = options.offset;
        if (options?.locale) params.locale = options.locale;
        // `GET /topics` returns `{ topics, total, limit, offset }`. The pagination
        // fields matter to callers, so return the whole envelope (typed) rather
        // than throwing them away.
        const response = await this.makeRequest<Partial<TopicListResult>>(
          'GET',
          '/topics',
          params,
          { cache: true, cacheTTL: CACHE_TIMES.SHORT }
        );
        const requestedLimit = typeof params.limit === 'number' ? params.limit : 0;
        const requestedOffset = typeof params.offset === 'number' ? params.offset : 0;
        return {
          topics: response.topics ?? [],
          total: response.total ?? response.topics?.length ?? 0,
          limit: response.limit ?? requestedLimit,
          offset: response.offset ?? requestedOffset,
        };
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
        // `POST /topics/resolve` returns `{ topics: Record<name, TopicData> }`
        // (a name-keyed map, not an array). Unwrap and flatten to the resolved
        // topics; each TopicData carries its own `name` for re-keying.
        const response = await this.makeRequest<{ topics: Record<string, TopicData> }>(
          'POST',
          '/topics/resolve',
          { names },
          { cache: false }
        );
        return Object.values(response.topics ?? {});
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
        const result = await this.makeRequest<TopicData>('PATCH', `/topics/${slug}`, data, {
          cache: false,
        });
        // Bust the cached topic detail so `getTopicBySlug(slug)` reflects the
        // updated metadata immediately (it caches at the LONG TTL).
        this.clearCacheEntry(`GET:/topics/${slug}`);
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}
