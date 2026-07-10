import mongoose, { Document, Schema } from "mongoose";
import { ORGANIZATION_CATEGORIES, type OrganizationCategory } from "@oxyhq/contracts";
import { maybeHashEmail, maybeHashPhone } from "../utils/contactHash";
import { composeDisplayName } from "../utils/displayName";
import { buildUserDid } from "../services/did.service";
import {
  TRUST_TIERS,
  INFLUENCE_MIN,
  type TrustTier,
} from "../utils/reputation.constants";

/**
 * Methods by which a user can prove ownership of a custom domain for the
 * verified-domain badge (self-sovereign identity layer — B7).
 */
export type VerifiedDomainMethod = 'dns-txt' | 'well-known';

/** A proven domain-ownership badge stored on the user document. */
export interface VerifiedDomain {
  domain: string;
  verifiedAt: Date;
  method: VerifiedDomainMethod;
}

/**
 * Canonical named color presets a user may pick. `oxy` is premium-gated at the
 * service layer (`user.service.ts` premium check) — the schema permits it here
 * so already-premium users can persist it.
 */
export const USER_COLOR_PRESETS = [
  'teal',
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'pink',
  'sky',
  'orange',
  'mint',
  'oxy',
] as const;

// 3- or 6-digit hex. Legacy accounts stored raw hex colors before the named
// presets existed; accept them so those users can still save unrelated profile
// changes without being forced to re-pick a preset.
const LEGACY_HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * True when `value` is a known named preset OR a legacy hex color. Used as the
 * `color` field validator so the strict preset enum no longer rejects existing
 * users' legacy hex values on save.
 */
export function isValidUserColor(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return (
    (USER_COLOR_PRESETS as readonly string[]).includes(value) ||
    LEGACY_HEX_COLOR_PATTERN.test(value)
  );
}

/**
 * Represents an authentication method linked to a user account.
 * Users can have multiple auth methods (identity, password, social) linked to the same account.
 */
export interface AuthMethod {
  type: 'identity' | 'password' | 'google' | 'apple' | 'github';
  linkedAt: Date;
  metadata?: {
    publicKey?: string;      // For identity type
    email?: string;          // For password/social types
    providerId?: string;     // For social types (Google ID, Apple ID, etc.)
  };
}

export type AuthMethodType = AuthMethod['type'];

/**
 * Canonical constructor for an {@link AuthMethod} entry.
 *
 * Every entry point that links an auth method (register, signup, social
 * sign-in, identity/password/social linking) stamps `linkedAt = new Date()`
 * and the provider `metadata` by hand. Centralising that here keeps the shape
 * identical across all of them and makes the linked-at semantics a single
 * source of truth.
 */
export function buildAuthMethod(type: AuthMethodType, metadata?: AuthMethod['metadata']): AuthMethod {
  return { type, linkedAt: new Date(), metadata };
}

/**
 * Account graph classification for the unified Account system. ORTHOGONAL to
 * the federation `type` field. `personal` accounts are the only ones that may
 * log in directly; the rest are operated through `AccountMember` rows.
 */
export const ACCOUNT_KINDS = ['personal', 'organization', 'project', 'bot'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** Re-export — single source of truth is `@oxyhq/contracts`. */
export { ORGANIZATION_CATEGORIES, type OrganizationCategory };

/** Account-graph lifecycle state (additive — non-personal accounts only). */
export const ACCOUNT_STATUSES = ['active', 'archived'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Maximum tree depth (ancestors length). Guards against pathological nesting. */
export const MAX_ACCOUNT_DEPTH = 8;

export interface IUser extends Document {
  username?: string;
  email?: string;
  phone?: string; // E.164-style phone number (optional). Raw form is private and never returned by public profile endpoints.
  /**
   * SHA-256 hex digest of the lowercased+trimmed email. Auto-maintained by a
   * pre-validate hook whenever `email` changes. Indexed for contact discovery
   * lookups via `POST /contacts/discover`.
   */
  hashedEmail?: string;
  /**
   * SHA-256 hex digest of the normalized E.164 phone number. Auto-maintained
   * by a pre-validate hook whenever `phone` changes. Indexed for contact
   * discovery lookups via `POST /contacts/discover`.
   */
  hashedPhone?: string;
  publicKey?: string; // ECDSA secp256k1 public key (hex) - primary identifier for local identity
  password?: string; // Hashed password for password-based accounts
  refreshToken?: string | null;
  authMethods?: AuthMethod[]; // Linked authentication methods for unified auth
  /**
   * Self-sovereign DID — `did:web:<DID_WEB_DOMAIN || FEDERATION_DOMAIN>:u:<_id>`.
   * VIRTUAL, derived from `_id` (the stable account anchor) via the SAME
   * `buildUserDid` helper used by the API, so the virtual and the served DID
   * document can never disagree. Surfaced in toJSON/toObject; never stored. See
   * `services/did.service.ts` for the single source of the format + domain.
   */
  did?: string;
  /**
   * Proven custom-domain ownership badges (self-sovereign identity layer — B7).
   * Populated only after a DNS-TXT or `/.well-known/oxy-domain` proof passes via
   * `POST /identity/domains/:domain/verify`. Surfaced in DID `alsoKnownAs` and
   * `formatUserResponse`. Additive — defaults to `[]`.
   */
  verifiedDomains?: VerifiedDomain[];
  type?: 'local' | 'federated' | 'agent' | 'automated';
  /**
   * Account graph classification (unified Account system). ORTHOGONAL to
   * `type` (the federation/automation flavour above): `kind` describes WHAT the
   * account is in the ownership tree, not how it federates.
   *  - `personal`     — a human login (the only kind that may authenticate
   *                     directly); always a tree root.
   *  - `organization` — a container account (e.g. a company/team).
   *  - `project`      — a sub-account that scopes a slice of apps/members.
   *  - `bot`          — a programmatic principal that acts as itself via an
   *                     {@link AccountCredential} service token.
   * Non-`personal` accounts have no direct login and are operated through
   * {@link AccountMember} rows.
   */
  kind?: AccountKind;
  /**
   * Real-estate / team taxonomy for `kind: 'organization'` accounts only
   * (agency, cooperative, landlord, other). Orthogonal to `kind` — never use
   * `kind` for Homiio-specific profile types.
   */
  organizationCategory?: OrganizationCategory;
  /** Adjacency edge: the immediate parent account in the tree (null for roots). */
  parentAccountId?: mongoose.Types.ObjectId | null;
  /** Materialised path of ancestor account ids, ordered root → immediate parent. */
  ancestors?: mongoose.Types.ObjectId[];
  /** The root of this account's tree (self for roots). */
  rootAccountId?: mongoose.Types.ObjectId;
  /**
   * Account-graph lifecycle state. `archived` accounts (DELETE /accounts/:id)
   * are hidden from the accessible forest but never hard-deleted, so their tree
   * edges and history survive. Personal accounts are deleted via the GDPR
   * self-delete flow, NOT archived here.
   */
  accountStatus?: AccountStatus;
  federation?: {
    actorUri?: string;  // ActivityPub actor URI (globally unique identifier)
    domain?: string;    // e.g. "mastodon.social"
    actorId?: string;   // Ref to FederatedActor._id in app DB
    /**
     * When the remote avatar was last (re-)fetched. Authoritative throttle
     * source across process restarts — a forced avatar refresh is skipped when
     * this is within the min-interval window. Set even on a 304 Not Modified so
     * the throttle advances without a re-download.
     */
    lastAvatarFetchedAt?: Date;
    /** ETag returned by the remote avatar host, replayed as `If-None-Match`. */
    avatarETag?: string;
    /** Last-Modified returned by the remote avatar host, replayed as `If-Modified-Since`. */
    avatarLastModified?: string;
    /** Last time the remote actor profile was successfully resolved. */
    lastResolvedAt?: Date;
    /** Set when the remote actor stops resolving and should leave discovery surfaces. */
    unavailableAt?: Date;
    unavailableReason?: string;
  };
  automation?: {
    ownerId?: string;   // User ID of the human owner/creator
  };
  twoFactorAuth?: {
    enabled: boolean;
    secret?: string; // TOTP secret (encrypted)
    backupCodes?: string[]; // Hashed backup codes
    verifiedAt?: Date; // When 2FA was last verified
  };
  following?: mongoose.Types.ObjectId[];
  followers?: mongoose.Types.ObjectId[];
  name?: {
    first?: string;
    last?: string;
    full?: string; // virtual
    displayName?: string; // virtual
  };
  verified?: boolean;
  /**
   * Denormalized reputation ranking weight (mirror of
   * `ReputationBalance.influence.rankingFeedbackWeight`, clamped to
   * [INFLUENCE_MIN, INFLUENCE_MAX]). Written by
   * `reputationService.recalculateBalance` so the recommendation scorer can join
   * a user's reputation signal cheaply at query time without a per-user lookup
   * into the `reputationbalances` collection. Defaults to the influence floor.
   */
  reputationRankWeight?: number;
  /**
   * Denormalized reputation trust tier (mirror of `ReputationBalance.trustTier`).
   * Written by `reputationService.recalculateBalance`. The recommendation scorer
   * uses it to floor `restricted` users out of the surface without a join.
   */
  reputationTier?: TrustTier;
  /**
   * Oxy platform staff flag. Grants access to staff-only operations such as
   * editing an Application's `type`/`isOfficial`/`isInternal`/`capabilities`
   * fields. Set in the DB by a platform administrator only — never via any
   * self-service API route. Gated by the `requireStaff` middleware.
   */
  isStaff?: boolean;
  /**
   * Proof-of-personhood seed verifier (civic / Commons — Fase 3). A hand-picked
   * genesis node of the web-of-trust: a seed verifier is treated as personhood
   * score = 1 (a known real, unique human) without needing vouches, so they can
   * bootstrap the network by vouching for others. Set in the DB by a platform
   * administrator only — never via any self-service API route.
   */
  isSeedVerifier?: boolean;
  /**
   * Account-level sensitivity flag. Marks the WHOLE account as NSFW/adult/
   * sensitive (e.g. an adult-content creator or a porn-bot caught by
   * moderation), as distinct from `privacySettings.sensitiveContent`, which is
   * the VIEWER's preference about seeing sensitive content. Set by moderation /
   * a platform administrator only — never via any self-service API route. The
   * recommendation/discovery surface (`eligibleUserMatch`) excludes accounts
   * with this flag so sensitive profiles are never suggested as "who to follow".
   * Defaults to `false`, so it is a no-op until populated.
   */
  isSensitive?: boolean;
  language?: string;
  privacySettings: {
    isPrivateAccount: boolean;
    hideOnlineStatus: boolean;
    hideLastSeen: boolean;
    profileVisibility: boolean;
    loginAlerts: boolean;
    blockScreenshots: boolean;
    login: boolean;
    biometricLogin: boolean;
    showActivity: boolean;
    allowTagging: boolean;
    allowMentions: boolean;
    hideReadReceipts: boolean;
    allowDirectMessages: boolean;
    dataSharing: boolean;
    locationSharing: boolean;
    analyticsSharing: boolean;
    sensitiveContent: boolean;
    autoFilter: boolean;
    muteKeywords: boolean;
    discoverableByEmail?: boolean;
    discoverableByPhone?: boolean;
    fediverseSharing: boolean;
  };
  // Avatar file ID referencing assets collection
  avatar?: string; // file id
  color?: string; // Named color preset (e.g. 'teal', 'blue', 'purple')
  _count?: {
    followers?: number;
    following?: number;
  };
  bio?: string;
  description?: string;
  address?: string;
  birthday?: string;
  locations?: Array<{
    id: string;
    name: string;
    label?: string;
    type?: 'home' | 'work' | 'school' | 'other';
    address?: {
      street?: string;
      streetNumber?: string;
      streetDetails?: string;
      postalCode?: string;
      city?: string;
      state?: string;
      country?: string;
      formattedAddress?: string;
    };
    coordinates?: {
      lat: number;
      lon: number;
    };
    metadata?: {
      placeId?: string;
      osmId?: string;
      osmType?: string;
      countryCode?: string;
      timezone?: string;
    };
    createdAt?: Date;
    updatedAt?: Date;
  }>;
  links?: string[];
  linksMetadata?: Array<{
    url: string;
    title: string;
    description: string;
    image?: string;
  }>;
  accountExpiresAfterInactivityDays?: number | null; // Days of inactivity before account expires (null = never expire)
  // Email settings
  emailSignature?: string;
  autoReply?: {
    enabled: boolean;
    subject?: string;
    body?: string;
    startDate?: Date;
    endDate?: Date;
  };
  autoForwardTo?: string; // If set, forward ALL incoming email to this address
  autoForwardKeepCopy?: boolean; // If true, keep the message in inbox too (default true)
  // User-controlled notification channels. All channels default to on; users
  // opt out per-channel.
  notificationPreferences?: {
    pushEnabled?: boolean;
    emailDigest?: boolean;
    securityAlerts?: boolean;
    marketingEmails?: boolean;
  };
  // General app-wide user preferences. Persisted across all Oxy apps.
  userPreferences?: {
    language?: string;
    theme?: 'light' | 'dark' | 'system';
    reduceMotion?: boolean;
    timezone?: string;
  };
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  addLocation(locationData: {
    id: string;
    name: string;
    label?: string;
    type?: 'home' | 'work' | 'school' | 'other';
    address?: {
      street?: string;
      streetNumber?: string;
      streetDetails?: string;
      postalCode?: string;
      city?: string;
      state?: string;
      country?: string;
      formattedAddress?: string;
    };
    coordinates?: { lat: number; lon: number };
    metadata?: {
      placeId?: string;
      osmId?: string;
      osmType?: string;
      countryCode?: string;
      timezone?: string;
    };
  }): Promise<IUser>;
  removeLocation(locationId: string): Promise<IUser>;
  findLocationsNear(lat: number, lon: number, maxDistance?: number): Promise<IUser[]>;
  updateLocationCoordinates(locationId: string, lat: number, lon: number): Promise<IUser>;
}

const NameSchema = new Schema({
  first: { type: String, default: "" },
  last: { type: String, default: "" },
});

// Virtual for full name
NameSchema.virtual('full').get(function() {
  const first = typeof this.first === 'string' ? this.first : '';
  const last = typeof this.last === 'string' ? this.last : '';
  return [first, last].filter(Boolean).join(' ').trim();
});

// Ensure virtual fields are serialized
NameSchema.set('toJSON', { virtuals: true });
NameSchema.set('toObject', { virtuals: true });

const UserSchema: Schema = new Schema(
  {
    username: {
      type: String,
      required: false,
      unique: true,
      sparse: true, // Allows null/undefined values while maintaining uniqueness
      trim: true,
      select: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true, // Allows null/undefined values while maintaining uniqueness
      trim: true,
      lowercase: true,
      select: true,
    },
    // Optional phone number stored in raw form for the owner's own use.
    // Never returned by public profile endpoints — use `hashedPhone` for matching.
    phone: {
      type: String,
      required: false,
      trim: true,
      select: false,
    },
    // SHA-256 hex digest of normalized email. Maintained by a pre-validate hook
    // — do not set directly. See utils/contactHash.ts for canonicalization.
    hashedEmail: {
      type: String,
      required: false,
      lowercase: true,
      trim: true,
      select: false,
    },
    // SHA-256 hex digest of E.164-normalized phone. Maintained by a pre-validate
    // hook — do not set directly. See utils/contactHash.ts for canonicalization.
    hashedPhone: {
      type: String,
      required: false,
      lowercase: true,
      trim: true,
      select: false,
    },
    publicKey: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      trim: true,
      select: true,
    },
    password: {
      type: String,
      select: false,
    },
    refreshToken: {
      type: String,
      default: null,
      select: false,
    },
    twoFactorAuth: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, select: false }, // TOTP secret
      backupCodes: { type: [String], select: false, default: [] }, // Hashed backup codes
      verifiedAt: { type: Date },
    },
    authMethods: {
      type: [{
        type: {
          type: String,
          enum: ['identity', 'password', 'google', 'apple', 'github'],
          required: true,
        },
        linkedAt: { type: Date, default: Date.now },
        metadata: {
          publicKey: { type: String },
          email: { type: String },
          providerId: { type: String },
        },
      }],
      default: [],
    },
    // Proven custom-domain ownership badges (self-sovereign identity layer — B7).
    // Written ONLY by the domain-verification route after a DNS-TXT or
    // /.well-known proof passes — never via a generic profile update.
    verifiedDomains: {
      type: [{
        domain: { type: String, required: true, lowercase: true, trim: true },
        verifiedAt: { type: Date, required: true },
        method: { type: String, enum: ['dns-txt', 'well-known'], required: true },
      }],
      default: [],
    },
    verified: {
      type: Boolean,
      default: false,
    },
    // Denormalized reputation signals (mirror of ReputationBalance). Maintained
    // by reputationService.recalculateBalance — do not set directly. Indexed so
    // the recommendation scorer can sort/floor on them without a join.
    reputationRankWeight: {
      type: Number,
      default: INFLUENCE_MIN,
      index: true,
    },
    reputationTier: {
      type: String,
      enum: TRUST_TIERS,
      default: 'new',
      index: true,
    },
    isStaff: {
      type: Boolean,
      default: false,
    },
    // Proof-of-personhood seed verifier (Fase 3) — genesis node of the
    // web-of-trust, treated as score = 1. Administrator-set only.
    isSeedVerifier: {
      type: Boolean,
      default: false,
    },
    // Account-level NSFW/adult/sensitive flag (moderation-set only — never via a
    // self-service route). Distinct from privacySettings.sensitiveContent (a
    // viewer preference). Indexed because the recommendation/discovery surface
    // filters candidates on it. Defaults to false → no-op until populated.
    isSensitive: {
      type: Boolean,
      default: false,
      index: true,
    },
    language: {
      type: String,
      default: 'en',
      select: true,
      trim: true,
    },
    following: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],
    followers: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],
    name: NameSchema,
    privacySettings: {
      isPrivateAccount: { type: Boolean, default: false },
      hideOnlineStatus: { type: Boolean, default: false },
      hideLastSeen: { type: Boolean, default: false },
      profileVisibility: { type: Boolean, default: true },
      loginAlerts: { type: Boolean, default: true },
      blockScreenshots: { type: Boolean, default: false },
      login: { type: Boolean, default: true },
      biometricLogin: { type: Boolean, default: false },
      showActivity: { type: Boolean, default: true },
      allowTagging: { type: Boolean, default: true },
      allowMentions: { type: Boolean, default: true },
      hideReadReceipts: { type: Boolean, default: false },
      allowDirectMessages: { type: Boolean, default: true },
      dataSharing: { type: Boolean, default: true },
      locationSharing: { type: Boolean, default: false },
      analyticsSharing: { type: Boolean, default: true },
      sensitiveContent: { type: Boolean, default: false },
      autoFilter: { type: Boolean, default: true },
      muteKeywords: { type: Boolean, default: false },
      // Contact discovery is opt-in. These default to false so stored email/phone
      // hashes cannot be used as an account-enumeration oracle unless the
      // target user explicitly chooses to be discoverable by that channel.
      discoverableByEmail: { type: Boolean, default: false },
      discoverableByPhone: { type: Boolean, default: false },
      fediverseSharing: { type: Boolean, default: true },
    },
  avatar: { type: String },
    color: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: isValidUserColor,
        message: 'Color must be a known preset or legacy hex color',
      },
      default: () => {
        const colors = USER_COLOR_PRESETS.filter((color) => color !== 'oxy');
        return colors[Math.floor(Math.random() * colors.length)];
      },
    },
    _count: {
      followers: { type: Number, default: 0 },
      following: { type: Number, default: 0 },
    },
    bio: { type: String },
    description: { type: String },
    address: { type: String, trim: true },
    birthday: { type: String, trim: true },
    locations: [{
      id: { type: String, required: true },
      name: { type: String, required: true },
      label: { type: String },
      type: { 
        type: String, 
        enum: ['home', 'work', 'school', 'other'],
        default: 'other'
      },
      address: {
        street: { type: String },
        streetNumber: { type: String },
        streetDetails: { type: String },
        postalCode: { type: String },
        city: { type: String },
        state: { type: String },
        country: { type: String },
        formattedAddress: { type: String }
      },
      coordinates: {
        lat: { type: Number, min: -90, max: 90 },
        lon: { type: Number, min: -180, max: 180 }
      },
      metadata: {
        placeId: { type: String },
        osmId: { type: String },
        osmType: { type: String },
        countryCode: { type: String },
        timezone: { type: String }
      },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now }
    }],
    links: [{ type: String }],
    linksMetadata: [{
      url: { type: String, required: true },
      title: { type: String, required: true },
      description: { type: String, required: true },
      image: { type: String }
    }],
    accountExpiresAfterInactivityDays: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      validate: {
        validator: function(value: number | null) {
          if (value === null || value === undefined) return true;
          if (typeof value !== 'number') return false;
          return [30, 90, 180, 365].includes(value);
        },
        message: 'accountExpiresAfterInactivityDays must be 30, 90, 180, 365, or null'
      }
    },
    // Email settings
    emailSignature: {
      type: String,
      default: '',
      select: false,
    },
    autoReply: {
      enabled: { type: Boolean, default: false },
      subject: { type: String, default: '' },
      body: { type: String, default: '' },
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
    },
    autoForwardTo: {
      type: String,
      default: '',
      select: false,
    },
    autoForwardKeepCopy: {
      type: Boolean,
      default: true,
      select: false,
    },
    // Unified Account graph (orthogonal to `type` below). `kind` classifies the
    // account in the ownership tree; `parentAccountId`/`ancestors`/`rootAccountId`
    // materialise the tree for O(1) head + subtree queries.
    kind: {
      type: String,
      enum: ACCOUNT_KINDS,
      default: 'personal',
      index: true,
    },
    organizationCategory: {
      type: String,
      enum: ORGANIZATION_CATEGORIES,
      required: false,
    },
    parentAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: { sparse: true },
    },
    ancestors: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
      index: true,
    },
    rootAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    accountStatus: {
      type: String,
      enum: ACCOUNT_STATUSES,
      default: 'active',
    },
    // Federated (ActivityPub / fediverse) user support
    type: {
      type: String,
      enum: ['local', 'federated', 'agent', 'automated'],
      default: 'local',
      index: true,
    },
    federation: {
      actorUri: { type: String, index: { sparse: true, unique: true } },
      domain: { type: String, index: { sparse: true } },
      actorId: { type: String, sparse: true },
      // Avatar conditional-request + throttle bookkeeping. Maintained by
      // federation.service when it (re-)downloads a remote avatar.
      lastAvatarFetchedAt: { type: Date },
      avatarETag: { type: String },
      avatarLastModified: { type: String },
      lastResolvedAt: { type: Date, index: { sparse: true } },
      unavailableAt: { type: Date, index: { sparse: true } },
      unavailableReason: { type: String },
    },
    automation: {
      ownerId: { type: String, index: { sparse: true } },
    },
    // User-controlled notification preferences (per-channel opt-in/out).
    // Updated via `PUT /users/me` (see updateProfile). All channels default
    // to on; users explicitly opt out per channel.
    notificationPreferences: {
      pushEnabled: { type: Boolean, default: true },
      emailDigest: { type: Boolean, default: true },
      securityAlerts: { type: Boolean, default: true },
      marketingEmails: { type: Boolean, default: false },
    },
    // General user preferences — applied across all Oxy apps for the user.
    // Persisted via `PUT /users/me`. `language` mirrors the i18n preference
    // already managed by setLanguagePreference; storing it here lets first-
    // load apps render in the user's language without an extra round-trip.
    userPreferences: {
      language: { type: String, default: '' },
      theme: {
        type: String,
        enum: ['light', 'dark', 'system'],
        default: 'system',
      },
      reduceMotion: { type: Boolean, default: false },
      timezone: { type: String, default: '' },
    },
  },
  {
    timestamps: true,
    strict: true,
    validateBeforeSave: true,
  }
);

// Virtual for id - prefer publicKey for local identity, fallback to MongoDB _id
UserSchema.virtual('id').get(function() {
  if (this.publicKey) {
    return this.publicKey;
  }
  return this._id?.toString();
});

// Self-sovereign DID virtual — derived from the stable account id (`_id`), NOT
// the keypair. Single source of the format is `services/did.service.ts`.
// Surfaced via the `virtuals: true` toJSON/toObject options below.
UserSchema.virtual('did').get(function() {
  const id = this._id?.toString();
  return id ? buildUserDid(id) : undefined;
});

// Remove transforms and rely on select options
UserSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: function(doc, ret) {
    // Ensure id is set to publicKey or fallback to _id
    ret.id = ret.publicKey || ret.id || ret._id?.toString();
    delete ret.password;
    delete ret._id;
    // Strip contact-discovery internals — these must never leak to clients.
    delete ret.hashedEmail;
    delete ret.hashedPhone;
    return ret;
  },
});

UserSchema.set("toObject", {
  virtuals: true,
  transform: function(doc, ret) {
    // Ensure id is set to publicKey or fallback to _id
    ret.id = ret.publicKey || ret.id || ret._id?.toString();
    delete ret.password;
    delete ret._id;
    // Strip contact-discovery internals — these must never leak to clients.
    delete ret.hashedEmail;
    delete ret.hashedPhone;
    return ret;
  },
});

// Indexes for frequently queried fields
// Note: email and username already have unique indexes from schema definition
// publicKey already has a unique index from the unique: true constraint

// Social graph indexes
UserSchema.index({ following: 1 });
UserSchema.index({ followers: 1 });

// Contact discovery indexes — sparse because most older users won't have a phone
// and federated/agent users may have neither field set.
UserSchema.index({ hashedEmail: 1 }, { sparse: true });
UserSchema.index({ hashedPhone: 1 }, { sparse: true });

// Verified-domain badge lookups (self-sovereign identity layer — B7). Sparse
// because the vast majority of accounts will never claim a custom domain.
UserSchema.index({ "verifiedDomains.domain": 1 }, { sparse: true });

// Unified Account graph — list a parent's children of a given kind efficiently.
UserSchema.index({ kind: 1, parentAccountId: 1 });

/**
 * Keep `hashedEmail` and `hashedPhone` in sync with their canonical sources
 * whenever a user document is created or its `email`/`phone` field changes.
 *
 * This is the single source of truth for hash maintenance — all entry points
 * (signup, social auth, profile update, identity linking, managed accounts)
 * use `.save()` and therefore flow through this hook.
 */
UserSchema.pre('validate', function syncContactHashes() {
  if (this.isNew || this.isModified('email')) {
    const email = this.get('email');
    this.set('hashedEmail', typeof email === 'string' ? maybeHashEmail(email) : undefined);
  }
  if (this.isNew || this.isModified('phone')) {
    const phone = this.get('phone');
    this.set('hashedPhone', typeof phone === 'string' ? maybeHashPhone(phone) : undefined);
  }
});

// Note: username and email are now optional, so we don't need compound index with username
// Email already has sparse unique index in schema

// Geospatial index for locations
UserSchema.index({ "locations.coordinates": "2dsphere" });
UserSchema.index({ "locations.address.city": 1 });
UserSchema.index({ "locations.address.country": 1 });
UserSchema.index({ "locations.type": 1 });

// Compound indexes for efficient location queries
UserSchema.index({ "locations.address.city": 1, "locations.address.country": 1 });
UserSchema.index({ "locations.type": 1, "locations.address.city": 1 });
UserSchema.index({ "locations.metadata.countryCode": 1, "locations.address.city": 1 });

// Text index for location name search
UserSchema.index({ "locations.name": "text", "locations.address.formattedAddress": "text" }, { 
  default_language: "en"
});

// Index for location timestamps
UserSchema.index({ "locations.createdAt": -1 });
UserSchema.index({ "locations.updatedAt": -1 });

// Virtual for full name
UserSchema.virtual('name.full').get(function() {
  const name = this.name as { first?: string; last?: string } | undefined;
  if (name && (name.first || name.last)) {
    const first = typeof name.first === 'string' ? name.first : '';
    const last = typeof name.last === 'string' ? name.last : '';
    return [first, last].filter(Boolean).join(' ').trim();
  }
  return '';
});

// Virtual for the structured display name — the user's REAL name only.
//
// Composition (see `utils/displayName.ts`, the single source of truth shared
// with the unit tests):
//   1. explicit name.displayName, else
//   2. name.full (composed from name.first / name.last; first-only is valid —
//      there is NO requirement that both parts exist), else
//   3. undefined.
//
// It does NOT synthesize a name from `username` / `publicKey`. When the user has
// no real name the getter returns `undefined` and the field is simply absent in
// the serialized JSON — clients fall back to the handle. All raw fields
// (`name.first`, `name.last`, `name.full`, `username`, `publicKey`) remain
// intact. Public DTO serializers expose it as `name.displayName`.
UserSchema.virtual('name.displayName').get(function() {
  return composeDisplayName({
    name: this.name as { first?: string; last?: string } | undefined,
  });
});

// Instance method to add a location
UserSchema.methods.addLocation = function(locationData: {
  id: string;
  name: string;
  label?: string;
  type?: 'home' | 'work' | 'school' | 'other';
  address?: {
    street?: string;
    streetNumber?: string;
    streetDetails?: string;
    postalCode?: string;
    city?: string;
    state?: string;
    country?: string;
    formattedAddress?: string;
  };
  coordinates?: { lat: number; lon: number };
  metadata?: {
    placeId?: string;
    osmId?: string;
    osmType?: string;
    countryCode?: string;
    timezone?: string;
  };
}) {
  if (!this.locations) {
    this.locations = [];
  }
  const locationWithTimestamps = {
    ...locationData,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  this.locations.push(locationWithTimestamps);
  return this.save();
};

// Instance method to remove a location by ID
UserSchema.methods.removeLocation = function(locationId: string) {
  if (this.locations) {
    this.locations = this.locations.filter((loc: NonNullable<IUser['locations']>[number]) => loc.id !== locationId);
    return this.save();
  }
  return Promise.resolve(this);
};

// Instance method to find locations near a point
UserSchema.methods.findLocationsNear = function(lat: number, lon: number, maxDistance: number = 10000) {
  return User.find({
    _id: this._id,
    "locations.coordinates": {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [lon, lat] // MongoDB uses [longitude, latitude] order
        },
        $maxDistance: maxDistance
      }
    }
  });
};

// Instance method to update location coordinates
UserSchema.methods.updateLocationCoordinates = function(locationId: string, lat: number, lon: number) {
  if (this.locations) {
    const location = this.locations.find((loc: NonNullable<IUser['locations']>[number]) => loc.id === locationId);
    if (location) {
      location.coordinates = { lat, lon };
      location.updatedAt = new Date();
      return this.save();
    }
  }
  return Promise.resolve(this);
};

export const User = mongoose.model<IUser>('User', UserSchema);
export default User;
