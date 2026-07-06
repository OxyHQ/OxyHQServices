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
    currentUserResponseSchema,
    deviceLinkedSessionSchema,
    deviceLinkedSessionsResponseSchema,
    // Helpers
    resolveUserId,
    safeParseContract,
} from './userResponse';

export type {
    UserNameResponse,
    UserResponse,
    UserProfileUpdate,
    CurrentUserResponseContract,
    DeviceLinkedSessionResponse,
    DeviceLinkedSessionsResponseContract,
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

export {
    // Schemas
    recommendationExcludeTypeSchema,
    recommendationBoostSchema,
    recommendationSignalWeightsSchema,
    recommendationRequestSchema,
    recommendationCountSchema,
    recommendationItemSchema,
    recommendationResponseSchema,
    appEndorsementInputSchema,
    appInterestInputSchema,
    appUserSignalIngestSchema,
    appAffinityEventTypeSchema,
    appAffinityEventSchema,
    appAffinityEventsIngestSchema,
} from './recommendations';

export type {
    RecommendationExcludeType,
    RecommendationBoost,
    RecommendationSignalWeights,
    RecommendationRequest,
    RecommendationCount,
    RecommendationItem,
    RecommendationResponse,
    AppEndorsementInput,
    AppInterestInput,
    AppUserSignalIngest,
    AppAffinityEventType,
    AppAffinityEvent,
    AppAffinityEventsIngest,
} from './recommendations';

export {
    // Schemas
    verificationMethodSchema,
    didServiceSchema,
    didDocumentSchema,
    signedRecordEnvelopeSchema,
    verifiedDomainSchema,
    domainVerificationRequestSchema,
    domainVerificationInstructionsSchema,
    authMethodEntrySchema,
    authMethodsResponseSchema,
    exportAttestationSchema,
    exportBundleSchema,
} from './identity';

export type {
    VerificationMethod,
    Secp256k1VerificationMethod,
    MultikeyVerificationMethod,
    DidService,
    DidDocument,
    SignedRecordEnvelope,
    VerifiedDomain,
    DomainVerificationRequest,
    DomainVerificationInstructions,
    AuthMethodEntry,
    AuthMethodsResponse,
    ExportAttestation,
    ExportBundle,
} from './identity';

export {
    // Schemas
    oxySignedRecordTypeSchema,
} from './oxyRecordTypes';

export type {
    OxySignedRecordType,
} from './oxyRecordTypes';

export {
    // Schemas
    chainHeadResponseSchema,
    logPageResponseSchema,
} from './protocol';

export type {
    LexiconRecord,
    ChainHeadResponse,
    LogPageResponse,
} from './protocol';

export {
    // Schemas
    publicCardSchema,
    signedPublicCardSchema,
    realLifeAttestationRecordSchema,
    realLifeAttestationResultSchema,
    validationVerdictRecordSchema,
    validationOpenRequestSchema,
    validationOpenResultSchema,
    validationRequestSummarySchema,
    validationVoteResultSchema,
    personhoodVouchRecordSchema,
    personhoodBreakdownSchema,
    personhoodStatusResultSchema,
    vouchResultSchema,
    // Verifiable Credentials (Fase 4 — NEW)
    credentialRecordSchema,
    verifiableCredentialResponseSchema,
    credentialIssueResultSchema,
    credentialListResultSchema,
    credentialVerifyResultSchema,
} from './civic';

export type {
    CardTrustTier,
    PersonhoodStatus,
    PublicCard,
    SignedPublicCard,
    RealLifeAttestationRecord,
    RealLifeAttestationResult,
    ValidationVerdict,
    ValidationRequestStatus,
    ValidationVerdictRecord,
    ValidationOpenRequest,
    ValidationOpenResult,
    ValidationRequestSummary,
    ValidationVoteResult,
    PersonhoodVouchRecord,
    PersonhoodBreakdown,
    PersonhoodStatusResult,
    VouchResult,
    // Verifiable Credentials (Fase 4 — NEW)
    CredentialStatus,
    CredentialRecord,
    VerifiableCredentialResponse,
    CredentialIssueResult,
    CredentialListResult,
    CredentialVerifyResult,
} from './civic';

export {
    // Schemas
    linkPreviewSchema,
    linkPreviewBatchRequestSchema,
    linkPreviewBatchResponseSchema,
    linkPreviewResponseSchema,
} from './links';

export type {
    LinkPreviewStatus,
    LinkPreview,
    LinkPreviewBatchRequest,
    LinkPreviewBatchResponse,
} from './links';

export {
    sessionAccountSchema,
    deviceSessionStateSchema,
    activeTokenSchema,
    deviceSessionSyncSchema,
    deviceTokenMintRequestSchema,
    deviceTokenMintResponseSchema,
} from './deviceSession';

export type {
    SessionAccount,
    DeviceSessionState,
    ActiveToken,
    DeviceSessionSync,
    DeviceTokenMintRequest,
    DeviceTokenMintResponse,
} from './deviceSession';

export {
    // Schemas
    deviceBootReasonSchema,
    deviceBootFragmentSchema,
    deviceExchangeRequestSchema,
    authTokenBundleSchema,
    webSessionResultSchema,
    tokenRefreshRequestSchema,
    tokenRefreshResponseSchema,
    deviceTokenIssueResponseSchema,
    loginResultSchema,
    deviceResolveRequestSchema,
    deviceResolveResponseSchema,
} from './deviceBoot';

export type {
    DeviceBootReason,
    DeviceBootFragment,
    DeviceExchangeRequest,
    AuthTokenBundle,
    WebSessionResult,
    WebSessionSession,
    WebSessionNoSession,
    TokenRefreshRequest,
    TokenRefreshResponse,
    DeviceTokenIssueResponse,
    LoginTwoFactorRequired,
    LoginSessionResult,
    LoginResult,
    DeviceResolveRequest,
    DeviceResolveAccount,
    DeviceResolveResponse,
} from './deviceBoot';
