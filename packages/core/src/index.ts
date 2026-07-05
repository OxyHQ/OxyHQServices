/**
 * @oxyhq/core — OxyHQ SDK Foundation
 *
 * Platform-agnostic core providing API client, authentication,
 * cryptographic identity, and shared utilities.
 *
 * Works in Node.js, Browser, and React Native.
 *
 * @example
 * ```ts
 * import { OxyServices, oxyClient } from '@oxyhq/core';
 *
 * const user = await oxyClient.signIn(publicKey);
 * ```
 *
 * Every export below is NOMINAL — no `export *`, no barrels, no compat shims.
 * If a symbol does not appear here, it is NOT part of the public API.
 */

// Ensure crypto polyfills are loaded before anything else
import './crypto/polyfill';

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------
export { OxyServices, OxyAuthenticationError, OxyAuthenticationTimeoutError } from './OxyServices';
export { OXY_CLOUD_URL, oxyClient } from './OxyServices';
export type { LinkedHttpClient } from './OxyServices.base';
// Auth-refresh handler surface — consumed by `@oxyhq/services`'s OxyContext to
// install an in-session access-token refresh handler on the owner HttpService
// (the linked-client refresh path delegates back to it).
export type { AuthRefreshReason, AuthRefreshHandler } from './HttpService';

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
export { ServiceCredentialMismatchError } from './mixins/OxyServices.auth';
export type { ServiceTokenResponse } from './mixins/OxyServices.auth';
// "Sign in with Oxy" — handoff (Workstream C)
export type {
    CommonsSignInHandle,
    CommonsSignInStatus,
    CommonsApprovalInfo,
    CommonsSignInActionResult,
} from './mixins/OxyServices.auth';
export type { ServiceApp, ServiceActingAsVerification } from './mixins/OxyServices.utility';
export type {
    ContactDiscoveryMatch,
    ContactDiscoveryResponse,
} from './mixins/OxyServices.contacts';
export type {
    BulkFollowEntry,
    BulkFollowResult,
    BulkUnfollowEntry,
    BulkUnfollowResult,
} from './mixins/OxyServices.user';
export { OxyAppDataIdentifierError } from './mixins/OxyServices.appData';

// ---------------------------------------------------------------------------
// User identity and handles
// ---------------------------------------------------------------------------
export {
    getNormalizedUserId,
    normalizeUserIdentity,
    normalizeUserIdentityOrNull,
} from './utils/userIdentity';
export {
    getCanonicalUserHandle,
    getNormalizedUserHandle,
} from './utils/userHandle';
export type { CanonicalUserHandleInput, UserHandleInput } from './utils/userHandle';
export { normalizeProfileLinks } from './utils/profileLinks';
export type { ProfileLink, ProfileLinkMetadata } from './utils/profileLinks';

// ---------------------------------------------------------------------------
// Connected apps (OAuth consent: public app identity + authorized-app grants)
// ---------------------------------------------------------------------------
export type {
    PublicApplication,
    ConnectedApp,
} from './mixins/OxyServices.connectedApps';

// ---------------------------------------------------------------------------
// Accounts (unified account graph: tree, membership, roles, bot credentials)
// plus the applications owned within it (Application = OAuth client).
// ---------------------------------------------------------------------------
export type {
    AccountKind,
    AccountRelationship,
    AccountRole,
    AccountMemberStatus,
    AccountMemberSource,
    AccountMember,
    AccountNode,
    AccountCredentialType,
    AccountCredentialEnvironment,
    AccountCredentialStatus,
    AccountCredential,
    AccountCredentialWithSecret,
    RotateAccountCredentialResult,
    ListAccountsOptions,
    CreateAccountInput,
    UpdateAccountInput,
    InviteAccountMemberInput,
    UpdateAccountMemberInput,
    TransferAccountOwnershipInput,
    CreateAccountCredentialInput,
    AccountSuccessResult,
    SwitchAccountResult,
    // Applications owned within the account graph (Application = OAuth client).
    Application,
    ApplicationType,
    ApplicationStatus,
    ApplicationCredential,
    ApplicationCredentialType,
    ApplicationCredentialStatus,
    ApplicationEnvironment,
    CreateApplicationInput,
    UpdateApplicationInput,
    CreateApplicationCredentialInput,
    ApplicationCredentialWithSecret,
    RotateApplicationCredentialResult,
    ApplicationUsagePeriod,
    ApplicationUsageSummary,
    ApplicationUsageByDay,
    ApplicationUsageByEndpoint,
    ApplicationUsageStats,
} from './mixins/OxyServices.accounts';

// ---------------------------------------------------------------------------
// Reputation (Oxy Trust: ledger, balances, disputes, rules, influence)
// ---------------------------------------------------------------------------
export type {
    ReputationCategory,
    TrustTier,
    ReputationTransactionStatus,
    ReputationTargetEntityType,
    ReputationDisputeStatus,
    ReputationInfluenceContext,
    ReputationTransaction,
    ReputationBalanceBreakdown,
    ReputationInfluence,
    ReputationReliability,
    ReputationBalance,
    ReputationDispute,
    ReputationRule,
    ReputationLeaderboardEntry,
    ReputationInfluenceResult,
    ReverseReputationTransactionResult,
    AwardReputationInput,
    CreateReputationDisputeInput,
    ResolveReputationDisputeInput,
    UpsertReputationRuleInput,
    ReverseReputationTransactionInput,
} from './mixins/OxyServices.reputation';

// ---------------------------------------------------------------------------
// Self-sovereign identity (DID, signed records, auth-method ↔ VM mapping,
// verified domains). Wire shapes (DidDocument, SignedRecordEnvelope,
// AuthMethodsResponse, VerifiedDomain, DomainVerificationInstructions,
// ExportBundle) live in `@oxyhq/contracts` — import them directly from there.
// ---------------------------------------------------------------------------
export { buildUserDid } from './mixins/OxyServices.identity';
export type {
    IdentityRecordType,
    UnlinkableAuthMethodType,
    LinkAuthMethodResult,
    PublishRecordResult,
    VerifyRecordResult,
    VerifyDomainResult,
    RemoveDomainResult,
} from './mixins/OxyServices.identity';

// ---------------------------------------------------------------------------
// Civic / Commons "Oxy ID" (public signed cards + Oxy ID QR payload) and Fase 2
// anti-gaming (real-life attestation QR + validator/jury). Wire shapes
// (PublicCard, SignedPublicCard, RealLifeAttestationResult,
// ValidationRequestSummary, ValidationVoteResult, ValidationVerdict, …) live in
// `@oxyhq/contracts` — import them from there. The SDK adds the client verdict
// wrapper, the QR payload parsers/builders, and the submit inputs/results.
// ---------------------------------------------------------------------------
export {
    parseIdPayload,
    parseAttestPayload,
    verifyPublicCardAttestation,
} from './mixins/OxyServices.civic';
export type {
    CivicCardResult,
    IdCardRef,
    AttestQrPayload,
    ParsedAttestPayload,
    SubmitRealLifeAttestationInput,
    DenyValidationResult,
    VouchForPersonInput,
    WithdrawVouchResult,
    IssueCredentialInput,
    RevokeCredentialResult,
} from './mixins/OxyServices.civic';
export type { UserNodeStatus, UserNodeMode, UserNodeController, UserNodeLivenessStatus, RegisterNodeInput, RemoveNodeResult } from './mixins/OxyServices.nodes';

// ---------------------------------------------------------------------------
// Auth helpers (token refresh, error normalisation, retry policies)
// ---------------------------------------------------------------------------
export {
    SessionSyncRequiredError,
    AuthenticationFailedError,
    ensureValidToken,
    isAuthenticationError,
    withAuthErrorHandling,
    authenticatedApiCall,
} from './utils/authHelpers';
export type { HandleApiErrorOptions } from './utils/authHelpers';

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export {
    mergeSessions,
    normalizeAndSortSessions,
    sessionsArraysEqual,
} from './utils/sessionUtils';
export type {
    ClientSession,
    StorageKeys,
    MinimalUserData,
    SessionLoginResponse,
} from './models/session';

// ---------------------------------------------------------------------------
// Crypto / identity
// ---------------------------------------------------------------------------
export {
    KeyManager,
    IdentityAlreadyExistsError,
    IdentityPersistError,
} from './crypto/keyManager';
export type { KeyPair } from './crypto/keyManager';
export { SignatureService } from './crypto/signatureService';
export type { SignedMessage, AuthChallenge } from './crypto/signatureService';
export { RecoveryPhraseService } from './crypto/recoveryPhrase';
export type { RecoveryPhraseResult } from './crypto/recoveryPhrase';

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------
export { DeviceManager } from './utils/deviceManager';
export type { DeviceFingerprint, StoredDeviceInfo } from './utils/deviceManager';

// ---------------------------------------------------------------------------
// Domain models / wire types
// ---------------------------------------------------------------------------
export type {
    OxyConfig,
    PrivacySettings,
    NotificationPreferences,
    UserPreferences,
    User,
    LoginResponse,
    Notification,
    Wallet,
    Transaction,
    BlockedUser,
    RestrictedUser,
    TransferFundsRequest,
    PurchaseRequest,
    WithdrawalRequest,
    TransactionResponse,
    PaginationInfo,
    SearchProfilesResponse,
    ApiError,
    PaymentMethod,
    PaymentRequest,
    PaymentResponse,
    AnalyticsData,
    FollowerDetails,
    ContentViewer,
    FileMetadata,
    FileUploadResponse,
    FileListResponse,
    FileUpdateRequest,
    FileDeleteResponse,
    RNFileDescriptor,
    AssetUploadInput,
    FileVisibility,
    AssetLink,
    AssetMetadata,
    AssetVariant,
    Asset,
    AssetInitRequest,
    AssetInitResponse,
    AssetCompleteRequest,
    AssetLinkRequest,
    AssetUnlinkRequest,
    AssetUrlResponse,
    AssetDeleteSummary,
    AssetUpdateVisibilityRequest,
    AssetUpdateVisibilityResponse,
    ServiceAssetMetadata,
    ServiceAssetMetadataBySha,
    AccountStorageCategoryUsage,
    AccountStorageUsageResponse,
    SecurityEventType,
    SecurityEventSeverity,
    SecurityActivity,
    SecurityActivityResponse,
    AssetUploadProgress,
    DeviceSession,
    DeviceSessionsResponse,
    DeviceSessionLogoutResponse,
    UpdateDeviceNameResponse,
} from './models/interfaces';
export { SECURITY_EVENT_SEVERITY_MAP } from './models/interfaces';

// Topic enums + type
export { TopicType, TopicSource } from './models/Topic';
export type { TopicData, TopicTranslation } from './models/Topic';

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------
export {
    SUPPORTED_LANGUAGES,
    getLanguageMetadata,
    getLanguageName,
    getNativeLanguageName,
    normalizeLanguageCode,
    isRTLLocale,
} from './utils/languageUtils';
export type { LanguageMetadata } from './utils/languageUtils';

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------
export {
    getPlatformOS,
    setPlatformOS,
    isWeb,
    isNative,
    isIOS,
    isAndroid,
    isWebBrowser,
} from './utils/platform';
export type { PlatformOS } from './utils/platform';

// ---------------------------------------------------------------------------
// Colour / theme utilities
// ---------------------------------------------------------------------------
export {
    darkenColor,
    lightenColor,
    hexToRgb,
    rgbToHex,
    withOpacity,
    isLightColor,
    getContrastTextColor,
} from './shared/utils/colorUtils';

export {
    normalizeTheme,
    normalizeColorScheme,
    getOppositeTheme,
    systemPrefersDarkMode,
    getSystemColorScheme,
} from './shared/utils/themeUtils';
export type { ThemeValue } from './shared/utils/themeUtils';

// ---------------------------------------------------------------------------
// HTTP / error / network helpers
// ---------------------------------------------------------------------------
export {
    HttpStatus,
    getErrorStatus,
    getErrorMessage,
    isAlreadyRegisteredError,
    isUnauthorizedError,
    isForbiddenError,
    isNotFoundError,
    isRateLimitError,
    isServerError,
    isNetworkError,
    isRetryableError,
} from './shared/utils/errorUtils';

export {
    DEFAULT_CIRCUIT_BREAKER_CONFIG,
    createCircuitBreakerState,
    calculateBackoffInterval,
    recordFailure,
    recordSuccess,
    shouldAllowRequest,
    delay,
    withRetry,
} from './shared/utils/networkUtils';
export type { CircuitBreakerState, CircuitBreakerConfig } from './shared/utils/networkUtils';

export {
    isDev,
    debugLog,
    debugWarn,
    debugError,
    createDebugLogger,
} from './shared/utils/debugUtils';

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
export { translate } from './i18n';

// ---------------------------------------------------------------------------
// API request / URL helpers
// ---------------------------------------------------------------------------
export {
    buildSearchParams,
    buildUrl,
    buildPaginationParams,
    safeJsonParse,
} from './utils/apiUtils';
export type {
    PaginationParams,
    ApiResponse,
    ErrorResponse,
} from './utils/apiUtils';

export {
    ErrorCodes,
    createApiError,
    handleHttpError,
    validateRequiredFields,
} from './utils/errorUtils';

export { retryAsync } from './utils/asyncUtils';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export {
    EMAIL_REGEX,
    USERNAME_REGEX,
    PASSWORD_REGEX,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    isValidDisplayName,
    isRequiredString,
    isRequiredNumber,
    isRequiredBoolean,
    isValidArray,
    isValidObject,
    isValidUUID,
    isValidURL,
    isValidDate,
    isValidFileSize,
    isValidFileType,
    sanitizeString,
    sanitizeHTML,
    isValidObjectId,
    validateAndSanitizeUserInput,
} from './utils/validationUtils';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
export {
    logger,
    LogLevel,
    logAuth,
    logApi,
    logSession,
    logUser,
    logDevice,
    logPayment,
    logPerformance,
} from './utils/loggerUtils';
export type { LogContext } from './utils/loggerUtils';

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------
export { updateAvatarVisibility } from './utils/avatarUtils';

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export {
    buildAccountsArray,
    createQuickAccount,
    getAccountDisplayName,
    getAccountFallbackHandle,
    formatPublicKeyHandle,
    getAccountColor,
} from './utils/accountUtils';
export type { QuickAccount, DisplayNameUserShape } from './utils/accountUtils';

// ---------------------------------------------------------------------------
// Registrable-domain + central-IdP-apex helpers.
//
// The client SSO-bounce / silent-iframe / FedCM machinery was removed in the
// device-first cutover (wave 2, ecosystem-wide bump complete). `registrableApex`
// (eTLD+1) and `CENTRAL_IDP_APEX` are still genuinely used: `registrableApex`
// via the `@oxyhq/core/server` re-export consumed by
// `packages/api/src/utils/sameSite.ts` for same-site origin checks, and
// `CENTRAL_IDP_APEX` by `server/cors.ts`'s `createOxyCors` (auto-allows
// `*.oxy.so`). `SSO_CALLBACK_PATH` has no remaining importer outside this
// module as of wave 2 — kept exported for now rather than removed here (an
// export deletion is a logic change, out of scope for a comment sweep); flag
// for a follow-up dead-export cleanup pass.
// ---------------------------------------------------------------------------
export { registrableApex } from './utils/registrableApex';
export { CENTRAL_IDP_APEX } from './utils/authWebUrl';
export { SSO_CALLBACK_PATH } from './utils/ssoBounce';

export { runColdBoot } from './utils/coldBoot';
export type {
    ColdBootStep,
    ColdBootStepResult,
    ColdBootSession,
    ColdBootSkip,
    ColdBootOutcome,
    RunColdBootOptions,
} from './utils/coldBoot';

// ---------------------------------------------------------------------------
// Session sync (device-scoped multi-account session client)
// ---------------------------------------------------------------------------
export { SessionClient } from './session/SessionClient';
export type { TokenTransport, SessionClientHost, SessionClientOptions } from './session/SessionClient';
// The injectable socket factory type: consumers that bundle socket.io-client
// (services/auth-sdk) pass its `io` export as `socketFactory` so realtime sync
// never relies on core's lazy dynamic import of a bare specifier.
export type { SocketIOFactory, MinimalSocket } from './session/socketLoader';

// Shared SessionClient integration layer: the host adapter, the pure
// DeviceSessionState projection helpers, and the client factory are defined
// ONCE here so `@oxyhq/services` and `@oxyhq/auth` both reuse them instead of
// duplicating a local copy. Each consumer supplies its own `TokenTransport`
// (native vs. web mint strategies differ) to `createSessionClient`.
export { createSessionClientHost } from './session/sessionClientHost';
export { createSessionClient } from './session/createSessionClient';
export {
    deviceStateToClientSessions,
    activeSessionIdOf,
    activeUserOf,
    accountIdsOf,
} from './session/projectSessionState';

// ---------------------------------------------------------------------------
// Device-first session machinery (auth centralization, wave 1) — additive.
// Persisted auth-state store, the unified refresh handler + scheduler, the
// cold-boot v2 runner, and the device-boot return-fragment consumer. Built ON
// the existing `runColdBoot` primitive + `SessionClient`; the legacy
// FedCM/SSO/CrossDomainAuth surface is untouched (cutover happens in F4).
// ---------------------------------------------------------------------------
export {
    createWebAuthStateStore,
    createNativeAuthStateStore,
    createMemoryAuthStateStore,
    AUTH_STATE_STORAGE_KEY,
    DEVICE_TOKEN_STORAGE_KEY,
} from './session/authStateStore';
export type {
    PersistedAuthState,
    AuthStateStore,
    NativeKeyValueStorage,
} from './session/authStateStore';

export {
    refreshPersistedSession,
    createAuthRefreshHandler,
    installAuthRefreshHandler,
    startTokenRefreshScheduler,
    TOKEN_REFRESH_LEAD_MS,
} from './session/refresh';
export type { RefreshDeps, TokenRefreshSchedulerHandle } from './session/refresh';

export {
    runSessionColdBoot,
    createBrowserColdBootDom,
    isSameApex,
    BOOT_ATTEMPTED_KEY,
} from './boot/coldBootV2';
export type {
    RunSessionColdBootOptions,
    ColdBootDom,
    SignedOutReason,
} from './boot/coldBootV2';

export {
    consumeDeviceBootReturn,
    parseDeviceBootFragment,
    hashHasBootFragment,
    BOOT_FRAGMENT_PARAM,
    BOOT_STATE_SESSION_KEY,
} from './boot/deviceBootReturn';
export type {
    DeviceBootSession,
    DeviceBootReturnOutcome,
    ConsumeDeviceBootReturnDeps,
} from './boot/deviceBootReturn';

// The web-session result contract (`WebSessionResult`) is owned by
// `@oxyhq/contracts` — import it directly from there; `@oxyhq/core` does not
// re-export contract types.

// API response contracts (request/response Zod schemas + inferred types) live in
// `@oxyhq/contracts` — the single source of truth shared by the backend and every
// client SDK. Import them directly from `@oxyhq/contracts`; `@oxyhq/core` does NOT
// re-export them (no barrel re-exports — clean imports from the owning package).

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export { packageInfo } from './constants/version';

// ---------------------------------------------------------------------------
// Default export (back-compat — OxyServices is the most common consumer entry)
// ---------------------------------------------------------------------------
import { OxyServices } from './OxyServices';
export default OxyServices;
