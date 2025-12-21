/**
 * Mutation Hooks
 * 
 * TanStack Query mutation hooks for updating Oxy services data.
 * All mutations handle authentication, error handling, and query invalidation.
 */

// Account mutation hooks
export {
  useUpdateProfile,
  useUploadAvatar,
  useUpdateAccountSettings,
  useUpdatePrivacySettings,
  useUploadFile,
  useUnblockUser,
  useUnrestrictUser,
} from './useAccountMutations';

// Service mutation hooks (sessions, devices)
export {
  useSwitchSession,
  useLogoutSession,
  useLogoutAll,
  useUpdateDeviceName,
  useRemoveDevice,
} from './useServicesMutations';

