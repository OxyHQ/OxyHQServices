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

// Service query hooks (sessions, devices, security)
export {
  useSessions,
  useSession,
  useDeviceSessions,
  useUserDevices,
  useSecurityInfo,
} from './useServicesQueries';

// Security activity query hooks
export {
  useSecurityActivity,
  useRecentSecurityActivity,
} from './useSecurityQueries';

// Query keys and invalidation helpers (for advanced usage)
export { queryKeys, invalidateAccountQueries, invalidateUserQueries, invalidateSessionQueries } from './queryKeys';

