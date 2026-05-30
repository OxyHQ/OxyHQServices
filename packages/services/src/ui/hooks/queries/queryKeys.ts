/**
 * Centralized query keys for TanStack Query
 * 
 * Following best practices:
 * - Use arrays for hierarchical keys
 * - Include all parameters in the key
 * - Use consistent naming conventions
 */

export const queryKeys = {
  // Account queries
  accounts: {
    all: ['accounts'] as const,
    lists: () => [...queryKeys.accounts.all, 'list'] as const,
    list: (sessionIds: string[]) => [...queryKeys.accounts.lists(), sessionIds] as const,
    details: () => [...queryKeys.accounts.all, 'detail'] as const,
    detail: (sessionId: string) => [...queryKeys.accounts.details(), sessionId] as const,
    current: () => [...queryKeys.accounts.all, 'current'] as const,
    settings: () => [...queryKeys.accounts.all, 'settings'] as const,
  },

  // User queries
  users: {
    all: ['users'] as const,
    lists: () => [...queryKeys.users.all, 'list'] as const,
    list: (userIds: string[]) => [...queryKeys.users.lists(), userIds] as const,
    details: () => [...queryKeys.users.all, 'detail'] as const,
    detail: (userId: string) => [...queryKeys.users.details(), userId] as const,
    profile: (sessionId: string) => [...queryKeys.users.details(), sessionId, 'profile'] as const,
  },

  // Session queries
  sessions: {
    all: ['sessions'] as const,
    lists: () => [...queryKeys.sessions.all, 'list'] as const,
    list: (userId?: string) => [...queryKeys.sessions.lists(), userId] as const,
    details: () => [...queryKeys.sessions.all, 'detail'] as const,
    detail: (sessionId: string) => [...queryKeys.sessions.details(), sessionId] as const,
    active: () => [...queryKeys.sessions.all, 'active'] as const,
    device: (deviceId: string) => [...queryKeys.sessions.all, 'device', deviceId] as const,
  },

  // Device queries
  devices: {
    all: ['devices'] as const,
    lists: () => [...queryKeys.devices.all, 'list'] as const,
    list: (userId?: string) => [...queryKeys.devices.lists(), userId] as const,
    details: () => [...queryKeys.devices.all, 'detail'] as const,
    detail: (deviceId: string) => [...queryKeys.devices.details(), deviceId] as const,
  },

  // Privacy settings queries
  privacy: {
    all: ['privacy'] as const,
    settings: (userId?: string) => [...queryKeys.privacy.all, 'settings', userId || 'current'] as const,
  },

  // Security activity queries
  security: {
    all: ['security'] as const,
    activity: (limit?: number, offset?: number, eventType?: string) =>
      [...queryKeys.security.all, 'activity', limit, offset, eventType] as const,
    recent: (limit: number) =>
      [...queryKeys.security.all, 'recent', limit] as const,
    infinite: (limit: number, eventType?: string) =>
      [...queryKeys.security.all, 'infinite', limit, eventType] as const,
  },

  // Storage usage queries
  storage: {
    all: ['storage'] as const,
    usage: () => [...queryKeys.storage.all, 'usage'] as const,
  },

  // Payment / wallet / subscription queries
  payments: {
    all: ['payments'] as const,
    subscription: (userId?: string) =>
      [...queryKeys.payments.all, 'subscription', userId || 'current'] as const,
    history: (userId?: string) =>
      [...queryKeys.payments.all, 'history', userId || 'current'] as const,
    wallet: (userId?: string) =>
      [...queryKeys.payments.all, 'wallet', userId || 'current'] as const,
    walletTransactions: (limit?: number, offset?: number, userId?: string) =>
      [
        ...queryKeys.payments.all,
        'wallet',
        userId || 'current',
        'transactions',
        limit,
        offset,
      ] as const,
  },
} as const;

/**
 * Helper to invalidate all account-related queries
 */
export const invalidateAccountQueries = (queryClient: any) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
};

/**
 * Helper to invalidate all user-related queries
 */
export const invalidateUserQueries = (queryClient: any) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
};

/**
 * Helper to invalidate all session-related queries
 */
export const invalidateSessionQueries = (queryClient: any) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
};

