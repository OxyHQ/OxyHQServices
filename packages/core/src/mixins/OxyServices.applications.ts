/**
 * Applications Methods Mixin
 *
 * Provides methods for managing Oxy applications, their members, and their
 * credentials via the `/applications` API. An application is a multi-user
 * entity: membership (with a role) grants permissions; credentials
 * (public/confidential/service) carry OAuth client identifiers and the
 * service-token API key material.
 *
 * Reference applications by their Mongo `_id` (`applicationId`) and credentials
 * by their `credentialId`. Never by name.
 */
import type { OxyServicesBase } from '../OxyServices.base';
import { CACHE_TIMES } from './mixinHelpers';

/**
 * Application classification. Set only by Oxy platform staff — never editable
 * through the normal member-facing update path.
 */
export type ApplicationType = 'first_party' | 'third_party' | 'internal' | 'system';

/** Lifecycle status of an application. */
export type ApplicationStatus = 'active' | 'suspended' | 'deleted' | 'pending_review';

/** Role a member holds within an application. */
export type ApplicationRole = 'owner' | 'admin' | 'developer' | 'viewer' | 'billing';

/** Membership lifecycle status. */
export type ApplicationMemberStatus = 'active' | 'invited' | 'removed';

/** Credential kind. `service` credentials mint service tokens. */
export type ApplicationCredentialType = 'public' | 'confidential' | 'service';

/** Deployment environment a credential is scoped to. */
export type ApplicationEnvironment = 'development' | 'staging' | 'production';

/** Credential lifecycle status. */
export type ApplicationCredentialStatus = 'active' | 'deprecated' | 'revoked';

/**
 * Client-facing Application shape returned by the `/applications` API.
 * Mirrors the server `Application` model with `_id` as a string and dates
 * serialized to ISO strings.
 */
export interface Application {
  _id: string;
  name: string;
  description?: string;
  websiteUrl?: string;
  icon?: string;
  type: ApplicationType;
  status: ApplicationStatus;
  isOfficial: boolean;
  isInternal: boolean;
  capabilities: string[];
  redirectUris: string[];
  scopes: string[];
  webhookUrl?: string;
  devWebhookUrl?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The calling user's own membership in this application, embedded by the API
   * on list (`GET /applications`) and detail (`GET /applications/:appId`)
   * responses. Use `callerMembership.permissions` to gate UI affordances.
   */
  callerMembership?: ApplicationMember;
}

/**
 * Client-facing ApplicationMember shape. `permissions` is derived from `role`
 * on the server at write time.
 */
export interface ApplicationMember {
  _id: string;
  applicationId: string;
  userId: string;
  role: ApplicationRole;
  permissions: string[];
  invitedByUserId?: string;
  joinedAt?: string;
  status: ApplicationMemberStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Client-facing ApplicationCredential shape. The raw secret is NEVER part of
 * this shape — it is returned exactly once, separately, at creation/rotation.
 */
export interface ApplicationCredential {
  _id: string;
  applicationId: string;
  name: string;
  publicKey: string;
  type: ApplicationCredentialType;
  environment: ApplicationEnvironment;
  scopes: string[];
  status: ApplicationCredentialStatus;
  lastUsedAt?: string;
  expiresAt?: string;
  /**
   * Audit link to the credential this one was rotated FROM. Populated by the
   * API on credentials created via rotation; absent on original credentials.
   */
  rotatedFromCredentialId?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

/** Input accepted by `createApplication`. Staff-only fields are not settable here. */
export interface CreateApplicationInput {
  name: string;
  description?: string;
  websiteUrl?: string;
  icon?: string;
  redirectUris?: string[];
  scopes?: string[];
}

/** Input accepted by `updateApplication`. Staff-only fields are not settable here. */
export interface UpdateApplicationInput {
  name?: string;
  description?: string;
  websiteUrl?: string;
  icon?: string;
  redirectUris?: string[];
  scopes?: string[];
  webhookUrl?: string;
  devWebhookUrl?: string;
  status?: ApplicationStatus;
}

/** Input accepted by `inviteApplicationMember`. The owner role cannot be invited. */
export interface InviteApplicationMemberInput {
  userId: string;
  role: Exclude<ApplicationRole, 'owner'>;
}

/** Input accepted by `updateApplicationMember`. */
export interface UpdateApplicationMemberInput {
  role: ApplicationRole;
}

/** Input accepted by `transferApplicationOwnership`. */
export interface TransferApplicationOwnershipInput {
  userId: string;
}

/** Input accepted by `createApplicationCredential`. */
export interface CreateApplicationCredentialInput {
  name: string;
  type: ApplicationCredentialType;
  environment: ApplicationEnvironment;
  scopes?: string[];
}

/** Result of creating a credential — `secret` is returned ONCE. */
export interface ApplicationCredentialWithSecret {
  credential: ApplicationCredential;
  secret: string;
}

/**
 * Result of rotating a credential. Extends the create result with audit fields:
 * the new plaintext `secret` is returned ONCE, plus `rotatedFrom` (the previous
 * credential's `credentialId`) and `graceExpiresAt` (ISO string marking when the
 * old credential stops being honoured during the rotation grace window).
 */
export interface RotateApplicationCredentialResult extends ApplicationCredentialWithSecret {
  /** The previous credential's `credentialId` that this rotation supersedes. */
  rotatedFrom: string;
  /** ISO timestamp at which the rotated-from credential's grace window ends. */
  graceExpiresAt: string;
}

/** Time window for application usage statistics. */
export type ApplicationUsagePeriod = '24h' | '7d' | '30d' | '90d';

/** Aggregate totals for an application over the requested period. */
export interface ApplicationUsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCredits: number;
  avgResponseTime: number;
  successfulRequests: number;
  errorRequests: number;
}

/** Per-day usage bucket. `_id` is the day key (e.g. `YYYY-MM-DD`). */
export interface ApplicationUsageByDay {
  _id: string;
  requests: number;
  tokens: number;
  credits: number;
}

/** Per-endpoint usage bucket. `_id` is the endpoint identifier. */
export interface ApplicationUsageByEndpoint {
  _id: string;
  requests: number;
  tokens: number;
}

/** Usage statistics for an application over a period. */
export interface ApplicationUsageStats {
  summary: ApplicationUsageSummary;
  byDay: ApplicationUsageByDay[];
  byEndpoint: ApplicationUsageByEndpoint[];
}

/** Result of a delete/remove/revoke/transfer operation. */
export interface ApplicationSuccessResult {
  success: boolean;
}

export function OxyServicesApplicationsMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * List applications the current user is an active member of.
     */
    async getApplications(): Promise<Application[]> {
      try {
        const res = await this.makeRequest<{ applications?: Application[] }>(
          'GET',
          '/applications',
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.MEDIUM },
        );
        return res.applications ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Create a new application. The caller becomes its `owner`.
     * @param data - Application configuration. Staff-only fields are ignored.
     */
    async createApplication(data: CreateApplicationInput): Promise<Application> {
      try {
        const res = await this.makeRequest<{ application: Application }>(
          'POST',
          '/applications',
          data,
          { cache: false },
        );
        return res.application;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Fetch a single application by id.
     * @param applicationId - The application's Mongo `_id`.
     */
    async getApplication(applicationId: string): Promise<Application> {
      try {
        const res = await this.makeRequest<{ application: Application }>(
          'GET',
          `/applications/${applicationId}`,
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.LONG },
        );
        return res.application;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Update an application's mutable fields.
     * @param applicationId - The application's Mongo `_id`.
     * @param data - Subset of updatable fields. Staff-only fields are ignored.
     */
    async updateApplication(
      applicationId: string,
      data: UpdateApplicationInput,
    ): Promise<Application> {
      try {
        const res = await this.makeRequest<{ application: Application }>(
          'PATCH',
          `/applications/${applicationId}`,
          data,
          { cache: false },
        );
        return res.application;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Soft-delete an application (owner only).
     * @param applicationId - The application's Mongo `_id`.
     */
    async deleteApplication(applicationId: string): Promise<ApplicationSuccessResult> {
      try {
        return await this.makeRequest<ApplicationSuccessResult>(
          'DELETE',
          `/applications/${applicationId}`,
          undefined,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * List members of an application.
     * @param applicationId - The application's Mongo `_id`.
     */
    async getApplicationMembers(applicationId: string): Promise<ApplicationMember[]> {
      try {
        const res = await this.makeRequest<{ members?: ApplicationMember[] }>(
          'GET',
          `/applications/${applicationId}/members`,
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.MEDIUM },
        );
        return res.members ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Add a member to an application.
     * @param applicationId - The application's Mongo `_id`.
     * @param data - Target user id and role (never `owner`).
     */
    async inviteApplicationMember(
      applicationId: string,
      data: InviteApplicationMemberInput,
    ): Promise<ApplicationMember> {
      try {
        const res = await this.makeRequest<{ member: ApplicationMember }>(
          'POST',
          `/applications/${applicationId}/members`,
          data,
          { cache: false },
        );
        return res.member;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Change a member's role.
     * @param applicationId - The application's Mongo `_id`.
     * @param memberId - The member's Mongo `_id`.
     * @param data - New role.
     */
    async updateApplicationMember(
      applicationId: string,
      memberId: string,
      data: UpdateApplicationMemberInput,
    ): Promise<ApplicationMember> {
      try {
        const res = await this.makeRequest<{ member: ApplicationMember }>(
          'PATCH',
          `/applications/${applicationId}/members/${memberId}`,
          data,
          { cache: false },
        );
        return res.member;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Remove a member from an application.
     * @param applicationId - The application's Mongo `_id`.
     * @param memberId - The member's Mongo `_id`.
     */
    async removeApplicationMember(
      applicationId: string,
      memberId: string,
    ): Promise<ApplicationSuccessResult> {
      try {
        return await this.makeRequest<ApplicationSuccessResult>(
          'DELETE',
          `/applications/${applicationId}/members/${memberId}`,
          undefined,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Transfer ownership of an application to another member (owner only).
     * Demotes the current owner to `admin` and promotes the target to `owner`.
     * @param applicationId - The application's Mongo `_id`.
     * @param data - Target user id.
     */
    async transferApplicationOwnership(
      applicationId: string,
      data: TransferApplicationOwnershipInput,
    ): Promise<ApplicationSuccessResult> {
      try {
        return await this.makeRequest<ApplicationSuccessResult>(
          'POST',
          `/applications/${applicationId}/transfer-ownership`,
          data,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * List an application's credentials. The response NEVER includes secrets.
     * @param applicationId - The application's Mongo `_id`.
     */
    async getApplicationCredentials(applicationId: string): Promise<ApplicationCredential[]> {
      try {
        const res = await this.makeRequest<{ credentials?: ApplicationCredential[] }>(
          'GET',
          `/applications/${applicationId}/credentials`,
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.MEDIUM },
        );
        return res.credentials ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Create a credential. The plaintext `secret` is returned exactly ONCE;
     * the server stores only a hash and will never return it again.
     * @param applicationId - The application's Mongo `_id`.
     * @param data - Credential configuration.
     */
    async createApplicationCredential(
      applicationId: string,
      data: CreateApplicationCredentialInput,
    ): Promise<ApplicationCredentialWithSecret> {
      try {
        return await this.makeRequest<ApplicationCredentialWithSecret>(
          'POST',
          `/applications/${applicationId}/credentials`,
          data,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Rotate a credential's secret. The new plaintext `secret` is returned
     * exactly ONCE, along with audit fields: `rotatedFrom` (the previous
     * credentialId) and `graceExpiresAt` (ISO string for the grace window during
     * which the old credential is still honoured).
     * @param applicationId - The application's Mongo `_id`.
     * @param credentialId - The credential's Mongo `_id`.
     */
    async rotateApplicationCredential(
      applicationId: string,
      credentialId: string,
    ): Promise<RotateApplicationCredentialResult> {
      try {
        return await this.makeRequest<RotateApplicationCredentialResult>(
          'POST',
          `/applications/${applicationId}/credentials/${credentialId}/rotate`,
          undefined,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Revoke a credential (`status='revoked'`). Revoked credentials can no
     * longer authenticate.
     * @param applicationId - The application's Mongo `_id`.
     * @param credentialId - The credential's Mongo `_id`.
     */
    async revokeApplicationCredential(
      applicationId: string,
      credentialId: string,
    ): Promise<ApplicationSuccessResult> {
      try {
        return await this.makeRequest<ApplicationSuccessResult>(
          'DELETE',
          `/applications/${applicationId}/credentials/${credentialId}`,
          undefined,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Fetch usage statistics for an application.
     * @param applicationId - The application's Mongo `_id`.
     * @param period - Time window (defaults to the server default).
     */
    async getApplicationUsage(
      applicationId: string,
      period?: ApplicationUsagePeriod,
    ): Promise<ApplicationUsageStats> {
      try {
        return await this.makeRequest<ApplicationUsageStats>(
          'GET',
          `/applications/${applicationId}/usage`,
          period ? { period } : undefined,
          { cache: true, cacheTTL: CACHE_TIMES.SHORT },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}
