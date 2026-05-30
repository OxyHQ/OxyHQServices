/**
 * Query Hooks
 * 
 * TanStack Query hooks for fetching Oxy services data.
 * All hooks follow the same pattern with optional `enabled` parameter.
 */

// Account and user query hooks
export {
  useUserProfile,
  useUserProfiles,
  useCurrentUser,
  useUserById,
  useUserByUsername,
  useUsersBySessions,
  usePrivacySettings,
} from './useAccountQueries';

// Service query hooks (sessions, devices, security, storage)
export {
  useSessions,
  useSession,
  useDeviceSessions,
  useUserDevices,
  useSecurityInfo,
  useAccountStorageUsage,
} from './useServicesQueries';

// Security activity query hooks
export {
  useSecurityActivity,
  useRecentSecurityActivity,
  useInfiniteSecurityActivity,
} from './useSecurityQueries';

// Payment / wallet / subscription query hooks
export {
  useUserSubscription,
  useUserPayments,
  useUserWallet,
  useUserWalletTransactions,
} from './usePaymentQueries';

// Payment / wallet / subscription domain types
export type {
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
  SubscriptionFeatures,
  Payment,
  Wallet,
  WalletTransaction,
  WalletTransactionType,
  WalletTransactionStatus,
  WalletPagination,
  WalletTransactionsResponse,
} from './paymentTypes';

// Query keys and invalidation helpers (for advanced usage)
export { queryKeys, invalidateAccountQueries, invalidateUserQueries, invalidateSessionQueries } from './queryKeys';

