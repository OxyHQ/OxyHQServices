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
    karmaScore?: number;
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
                return await this.makeRequest<FeedbackResult>('POST', '/api/feedback', payload, {
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
                return await this.makeRequest<SubscriptionPlan[]>('GET', '/api/subscriptions/plans', undefined, {
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
                return await this.makeRequest<any[]>('GET', '/api/subscriptions/features', undefined, {
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
                return await this.makeRequest<SubscriptionResult>('POST', '/api/subscriptions/subscribe', {
                    planId,
                    paymentMethodId,
                }, { cache: false });
            }, 'subscribe');
        }

        /**
         * Subscribe to an individual feature
         */
        async subscribeToFeature(featureId: string, paymentMethodId?: string): Promise<SubscriptionResult> {
            return this.withAuthRetry(async () => {
                return await this.makeRequest<SubscriptionResult>('POST', '/api/subscriptions/features/subscribe', {
                    featureId,
                    paymentMethodId,
                }, { cache: false });
            }, 'subscribeToFeature');
        }

        /**
         * Cancel subscription
         */
        async cancelSubscription(subscriptionId: string): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('POST', `/api/subscriptions/${subscriptionId}/cancel`, undefined, {
                    cache: false,
                });
            }, 'cancelSubscription');
        }

        /**
         * Reactivate subscription
         */
        async reactivateSubscription(subscriptionId: string): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('POST', `/api/subscriptions/${subscriptionId}/reactivate`, undefined, {
                    cache: false,
                });
            }, 'reactivateSubscription');
        }

        /**
         * Get current user's subscription
         */
        async getCurrentSubscription(): Promise<SubscriptionResult | null> {
            return this.withAuthRetry(async () => {
                try {
                    return await this.makeRequest<SubscriptionResult>('GET', '/api/subscriptions/current', undefined, {
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
                const endpoint = userId ? `/api/users/${userId}/saves` : '/api/saves';
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
                const endpoint = userId ? `/api/users/${userId}/collections` : '/api/collections';
                return await this.makeRequest<Collection[]>('GET', endpoint, undefined, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.SHORT,
                });
            }, 'getCollections');
        }

        /**
         * Save an item
         */
        async saveItem(itemId: string, itemType: string, collectionId?: string): Promise<SavedItem> {
            return this.withAuthRetry(async () => {
                return await this.makeRequest<SavedItem>('POST', '/api/saves', {
                    itemId,
                    itemType,
                    collectionId,
                }, { cache: false });
            }, 'saveItem');
        }

        /**
         * Remove an item from saves
         */
        async removeSavedItem(saveId: string): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('DELETE', `/api/saves/${saveId}`, undefined, { cache: false });
            }, 'removeSavedItem');
        }

        /**
         * Create a collection
         */
        async createCollection(name: string, description?: string): Promise<Collection> {
            return this.withAuthRetry(async () => {
                return await this.makeRequest<Collection>('POST', '/api/collections', {
                    name,
                    description,
                }, { cache: false });
            }, 'createCollection');
        }

        /**
         * Delete a collection
         */
        async deleteCollection(collectionId: string): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('DELETE', `/api/collections/${collectionId}`, undefined, { cache: false });
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
                return await this.makeRequest<UserStats>('GET', `/api/users/${userId}/stats`, undefined, {
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

                const endpoint = userId ? `/api/users/${userId}/history` : '/api/history';
                return await this.makeRequest<HistoryItem[]>('GET', endpoint, params, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.SHORT,
                });
            }, 'getUserHistory');
        }

        /**
         * Clear user history
         */
        async clearUserHistory(): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('DELETE', '/api/history', undefined, { cache: false });
            }, 'clearUserHistory');
        }

        /**
         * Delete a history item
         */
        async deleteHistoryItem(itemId: string): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('DELETE', `/api/history/${itemId}`, undefined, { cache: false });
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
                return await this.makeRequest<FAQ[]>('GET', '/api/faqs', params, {
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
                return await this.makeRequest<FAQ[]>('GET', '/api/faqs/search', { query }, {
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
                const endpoint = userId ? `/api/users/${userId}/achievements` : '/api/achievements';
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
                return await this.makeRequest<Achievement[]>('GET', '/api/achievements/all', undefined, {
                    cache: true,
                    cacheTTL: CACHE_TIMES.LONG,
                });
            } catch (error) {
                throw this.handleError(error);
            }
        }

        // ==================
        // ACCOUNT
        // ==================

        /**
         * Delete user account (requires password confirmation)
         */
        async deleteAccount(password: string): Promise<void> {
            return this.withAuthRetry(async () => {
                await this.makeRequest('DELETE', '/api/account', { password }, { cache: false });
            }, 'deleteAccount');
        }
    };
}
