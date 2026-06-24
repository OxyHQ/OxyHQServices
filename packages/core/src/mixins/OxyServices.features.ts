/**
 * Features Methods Mixin
 *
 * Provides methods for various features:
 * - Feedback submission
 * - Subscription plans
 * - Saves/Collections
 * - User history
 * - FAQ
 * - User stats
 * - Achievements
 */
import type { OxyServicesBase } from '../OxyServices.base';
import { CACHE_TIMES } from './mixinHelpers';

// Types
export interface FeedbackPayload {
    type: 'bug' | 'feature' | 'general' | 'support';
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    category: string;
    contactEmail?: string;
    systemInfo?: {
        platform: string;
        version: string;
        appVersion: string;
        userId?: string;
        username?: string;
        timestamp: string;
    };
}

export interface FeedbackResult {
    id: string;
    status: string;
    createdAt: string;
}

export interface SubscriptionPlan {
    id: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    interval: 'month' | 'year';
    features: string[];
}

export interface SubscriptionResult {
    subscriptionId: string;
    status: string;
    currentPeriodEnd: string;
}

export interface SavedItem {
    id: string;
    itemId: string;
    itemType: string;
    title: string;
    createdAt: string;
}

export interface Collection {
    id: string;
    name: string;
    description?: string;
    itemCount: number;
    createdAt: string;
}

export interface UserStats {
    postCount: number;
    commentCount: number;
    followerCount: number;
    followingCount: number;
}

export interface HistoryItem {
    id: string;
    type: string;
    title: string;
    timestamp: string;
    metadata?: Record<string, any>;
}

export interface FAQ {
    id: string;
    question: string;
    answer: string;
    category: string;
}

export interface Achievement {
    id: string;
    name: string;
    description: string;
    icon: string;
    unlockedAt?: string;
}

export function OxyServicesFeaturesMixin<T extends typeof OxyServicesBase>(Base: T) {
    return class extends Base {
        constructor(...args: any[]) {
            super(...(args as [any]));
        }

        // ==================
        // FEEDBACK METHODS
        // ==================

        /**
         * Submit user feedback
         */
        async submitFeedback(payload: FeedbackPayload): Promise<FeedbackResult> {
            try {
                return await this.makeRequest<FeedbackResult>('POST', '/feedback', payload, {
                    cache: false,
                });
            } catch (error) {
                throw this.handleError(error);
            }
        }

        // ==================
        // SUBSCRIPTION METHODS
        // ==================

        /**
         * Get available subscription plans
         */
        async getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
            try {
                return await this.makeRequest<SubscriptionPlan[]>('GET', '/subscriptions/plans', undefined, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.LONG,
                });
            } catch (error) {
                throw this.handleError(error);
            }
        }

        /**
         * Get individual purchasable features
         */
        async getIndividualFeatures(): Promise<any[]> {
            try {
                return await this.makeRequest<any[]>('GET', '/subscriptions/features', undefined, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.LONG,
                });
            } catch (error) {
                throw this.handleError(error);
            }
        }

        /**
         * Subscribe to a plan
         */
        async subscribe(planId: string, paymentMethodId?: string): Promise<SubscriptionResult> {
            return this.withAuthRetry(async () => {
                const result = await this.makeRequest<SubscriptionResult>('POST', '/subscriptions/subscribe', {
                    planId,
                    paymentMethodId,
                }, { cache: false });
                // The current subscription changed — bust its cached read so
                // `getCurrentSubscription()` reflects the new plan immediately.
                this.clearCacheEntry('GET:/subscriptions/current');
                return result;
            }, 'subscribe');
        }

        /**
         * Subscribe to an individual feature
         */
        async subscribeToFeature(featureId: string, paymentMethodId?: string): Promise<SubscriptionResult> {
            return this.withAuthRetry(async () => {
                const result = await this.makeRequest<SubscriptionResult>('POST', '/subscriptions/features/subscribe', {
                    featureId,
                    paymentMethodId,
                }, { cache: false });
                this.clearCacheEntry('GET:/subscriptions/current');
                return result;
            }, 'subscribeToFeature');
        }

        /**
         * Cancel subscription
         */
        async cancelSubscription(subscriptionId: string): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('POST', `/subscriptions/${subscriptionId}/cancel`, undefined, {
                    cache: false,
                });
                this.clearCacheEntry('GET:/subscriptions/current');
            }, 'cancelSubscription');
        }

        /**
         * Reactivate subscription
         */
        async reactivateSubscription(subscriptionId: string): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('POST', `/subscriptions/${subscriptionId}/reactivate`, undefined, {
                    cache: false,
                });
                this.clearCacheEntry('GET:/subscriptions/current');
            }, 'reactivateSubscription');
        }

        /**
         * Get current user's subscription
         */
        async getCurrentSubscription(): Promise<SubscriptionResult | null> {
            return this.withAuthRetry(async () => {
                try {
                    return await this.makeRequest<SubscriptionResult>('GET', '/subscriptions/current', undefined, {
                        cache: true,
                        cacheTTL: CACHE_TIMES.SHORT,
                    });
                } catch (error: any) {
                    if (error.status === 404) return null;
                    throw error;
                }
            }, 'getCurrentSubscription');
        }

        // ==================
        // SAVES/COLLECTIONS
        // ==================

        /**
         * Get user's saved items
         */
        async getSavedItems(userId?: string): Promise<SavedItem[]> {
            return this.withAuthRetry(async () => {
                const endpoint = userId ? `/users/${userId}/saves` : '/saves';
                return await this.makeRequest<SavedItem[]>('GET', endpoint, undefined, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.SHORT,
                });
            }, 'getSavedItems');
        }

        /**
         * Get user's collections
         */
        async getCollections(userId?: string): Promise<Collection[]> {
            return this.withAuthRetry(async () => {
                const endpoint = userId ? `/users/${userId}/collections` : '/collections';
                return await this.makeRequest<Collection[]>('GET', endpoint, undefined, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.SHORT,
                });
            }, 'getCollections');
        }

        /**
         * Save an item.
         *
         * Busts the cached own saved-items list (`GET /saves`, ~short TTL) so a
         * follow-up `getSavedItems()` observes the new item. The `userId`-scoped
         * variant (`/users/<id>/saves`) is another user's list and is not
         * affected by the caller's own save.
         */
        async saveItem(itemId: string, itemType: string, collectionId?: string): Promise<SavedItem> {
            return this.withAuthRetry(async () => {
                const result = await this.makeRequest<SavedItem>('POST', '/saves', {
                    itemId,
                    itemType,
                    collectionId,
                }, { cache: false });
                this.clearCacheEntry('GET:/saves');
                return result;
            }, 'saveItem');
        }

        /**
         * Remove an item from saves.
         *
         * Busts the cached own saved-items list so the removed item is gone on
         * the next read (see `saveItem`).
         */
        async removeSavedItem(saveId: string): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('DELETE', `/saves/${saveId}`, undefined, { cache: false });
                this.clearCacheEntry('GET:/saves');
            }, 'removeSavedItem');
        }

        /**
         * Create a collection.
         *
         * Busts the cached own collections list (`GET /collections`) so the new
         * collection appears on the next read.
         */
        async createCollection(name: string, description?: string): Promise<Collection> {
            return this.withAuthRetry(async () => {
                const result = await this.makeRequest<Collection>('POST', '/collections', {
                    name,
                    description,
                }, { cache: false });
                this.clearCacheEntry('GET:/collections');
                return result;
            }, 'createCollection');
        }

        /**
         * Delete a collection.
         *
         * Busts the cached own collections list so the deleted collection is
         * gone on the next read (see `createCollection`).
         */
        async deleteCollection(collectionId: string): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('DELETE', `/collections/${collectionId}`, undefined, { cache: false });
                this.clearCacheEntry('GET:/collections');
            }, 'deleteCollection');
        }

        // ==================
        // USER STATS
        // ==================

        /**
         * Get user statistics
         */
        async getUserStats(userId: string): Promise<UserStats> {
            try {
                return await this.makeRequest<UserStats>('GET', `/users/${userId}/stats`, undefined, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.MEDIUM,
                });
            } catch (error) {
                throw this.handleError(error);
            }
        }

        // ==================
        // HISTORY
        // ==================

        /**
         * Get user history
         */
        async getUserHistory(userId?: string, limit?: number, offset?: number): Promise<HistoryItem[]> {
            return this.withAuthRetry(async () => {
                const params: any = {};
                if (limit) params.limit = limit;
                if (offset) params.offset = offset;

                const endpoint = userId ? `/users/${userId}/history` : '/history';
                return await this.makeRequest<HistoryItem[]>('GET', endpoint, params, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.SHORT,
                });
            }, 'getUserHistory');
        }

        /**
         * Clear user history.
         *
         * `getUserHistory` caches per (limit, offset) page, so its cache key
         * carries serialized params (`GET:/history` and `GET:/history:<params>`).
         * A prefix sweep busts every cached page of the own history at once.
         */
        async clearUserHistory(): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('DELETE', '/history', undefined, { cache: false });
                this.clearCacheByPrefix('GET:/history');
            }, 'clearUserHistory');
        }

        /**
         * Delete a history item.
         *
         * Busts every cached page of the own history (see `clearUserHistory`)
         * so the removed item no longer appears on the next read.
         */
        async deleteHistoryItem(itemId: string): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('DELETE', `/history/${itemId}`, undefined, { cache: false });
                this.clearCacheByPrefix('GET:/history');
            }, 'deleteHistoryItem');
        }

        // ==================
        // FAQ
        // ==================

        /**
         * Get FAQs
         */
        async getFAQs(category?: string): Promise<FAQ[]> {
            try {
                const params = category ? { category } : undefined;
                return await this.makeRequest<FAQ[]>('GET', '/faqs', params, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.LONG,
                });
            } catch (error) {
                throw this.handleError(error);
            }
        }

        /**
         * Search FAQs
         */
        async searchFAQs(query: string): Promise<FAQ[]> {
            try {
                return await this.makeRequest<FAQ[]>('GET', '/faqs/search', { query }, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.MEDIUM,
                });
            } catch (error) {
                throw this.handleError(error);
            }
        }

        // ==================
        // ACHIEVEMENTS
        // ==================

        /**
         * Get user achievements
         */
        async getUserAchievements(userId?: string): Promise<Achievement[]> {
            return this.withAuthRetry(async () => {
                const endpoint = userId ? `/users/${userId}/achievements` : '/achievements';
                return await this.makeRequest<Achievement[]>('GET', endpoint, undefined, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.MEDIUM,
                });
            }, 'getUserAchievements');
        }

        /**
         * Get all available achievements
         */
        async getAllAchievements(): Promise<Achievement[]> {
            try {
                return await this.makeRequest<Achievement[]>('GET', '/achievements/all', undefined, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.LONG,
                });
            } catch (error) {
                throw this.handleError(error);
            }
        }

        // Account deletion lives in OxyServices.user mixin — it requires
        // an identity-key signature (not just a password) and hits DELETE /users/me.
    };
}
