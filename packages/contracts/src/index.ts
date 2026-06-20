/**
 * @oxyhq/contracts — single source of truth for API request/response contracts.
 *
 * Zod schemas plus their inferred types, shared by the backend (`@oxyhq/api`)
 * and the client SDKs (`@oxyhq/core`, `@oxyhq/auth`, `@oxyhq/services`). The
 * producer validates its output and every consumer validates its input against
 * exactly the same definitions, so the wire shape cannot drift.
 *
 * Platform-agnostic — zod is the only runtime dependency. No react/react-native/
 * expo, no `require()` in the ESM build.
 */

export {
    // Schemas
    userNameSchema,
    userResponseSchema,
    userProfileUpdateSchema,
    refreshAllAccountSchema,
    refreshAllResponseSchema,
    currentUserResponseSchema,
    deviceSessionAccountSchema,
    deviceSessionsResponseSchema,
    // Helpers
    resolveUserId,
    safeParseContract,
} from './userResponse';

export type {
    UserNameResponse,
    UserResponse,
    UserProfileUpdate,
    RefreshAllAccountResponse,
    RefreshAllResponseContract,
    CurrentUserResponseContract,
    DeviceSessionAccountResponse,
    DeviceSessionsResponseContract,
} from './userResponse';

export {
    // Schemas
    applicationTypeSchema,
    publicApplicationSchema,
    sessionStatusSchema,
} from './sessionStatus';

export type {
    ApplicationTypeContract,
    PublicApplicationResponse,
    SessionStatusResponse,
} from './sessionStatus';

export {
    // Schemas
    fedcmTokenPayloadSchema,
} from './fedcmToken';

export type {
    FedcmTokenPayload,
} from './fedcmToken';
