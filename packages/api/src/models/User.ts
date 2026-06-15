import mongoose, { Document, Schema } from "mongoose";
import { maybeHashEmail, maybeHashPhone } from "../utils/contactHash";
import { composeDisplayName } from "../utils/displayName";

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
  type?: 'local' | 'federated' | 'agent' | 'automated';
  isManagedAccount?: boolean;
  managedBy?: mongoose.Types.ObjectId;
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
  };
  verified?: boolean;
  /**
   * Oxy platform staff flag. Grants access to staff-only operations such as
   * editing an Application's `type`/`isOfficial`/`isInternal`/`capabilities`
   * fields. Set in the DB by a platform administrator only — never via any
   * self-service API route. Gated by the `requireStaff` middleware.
   */
  isStaff?: boolean;
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
    authMethods: [{
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
    verified: {
      type: Boolean,
      default: false,
    },
    isStaff: {
      type: Boolean,
      default: false,
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
    },
  avatar: { type: String },
    color: {
      type: String,
      trim: true,
      lowercase: true,
      enum: ['teal', 'blue', 'green', 'amber', 'red', 'purple', 'pink', 'sky', 'orange', 'mint', 'oxy'],
      default: () => {
        const colors = ['teal', 'blue', 'green', 'amber', 'red', 'purple', 'pink', 'sky', 'orange', 'mint'];
        return colors[Math.floor(Math.random() * colors.length)];
      },
    },
    _count: {
      followers: { type: Number, default: 0 },
      following: { type: Number, default: 0 },
    },
    bio: { type: String },
    description: { type: String },
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
    // Managed account (sub-account) support
    isManagedAccount: {
      type: Boolean,
      default: false,
      index: true,
    },
    managedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: { sparse: true },
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

// Virtual for display name — authoritative server-side default.
//
// Composition preference order (see `utils/displayName.ts`, the single source of
// truth shared with the unit tests):
//   1. name.full (composed from name.first / name.last; first-only is valid —
//      there is NO requirement that both parts exist)
//   2. username
//   3. truncated publicKey handle
//   4. 'Anonymous'
//
// This is the DERIVED default only. All raw fields (name.first, name.last,
// name.full, username, publicKey) remain fully intact and exposed on the
// response — clients can still compose their own display string from raw fields.
UserSchema.virtual('displayName').get(function() {
  return composeDisplayName({
    name: this.name as { first?: string; last?: string } | undefined,
    username: this.username as string | undefined,
    publicKey: this.publicKey as string | undefined,
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
    this.locations = this.locations.filter((loc: any) => loc.id !== locationId);
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
    const location = this.locations.find((loc: any) => loc.id === locationId);
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
