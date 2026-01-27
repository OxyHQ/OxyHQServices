import mongoose, { Document, Schema } from "mongoose";

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
  publicKey?: string; // ECDSA secp256k1 public key (hex) - primary identifier for local identity
  password?: string; // Hashed password for password-based accounts
  refreshToken?: string | null;
  authMethods?: AuthMethod[]; // Linked authentication methods for unified auth
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
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  
  // Virtual properties
  primaryLocation?: string;
  
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
  avatar: { type: String, default: "" },
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
    return ret;
  },
});

// Indexes for frequently queried fields
// Note: email and username already have unique indexes from schema definition
// publicKey already has a unique index from the unique: true constraint

// Social graph indexes
UserSchema.index({ following: 1 });
UserSchema.index({ followers: 1 });

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

// Virtual for primary location (backward compatibility)
UserSchema.virtual('primaryLocation').get(function() {
  const locations = this.locations as Array<any> | undefined;
  if (locations && Array.isArray(locations) && locations.length > 0) {
    return locations[0].name;
  }
  return '';
});

// Virtual for display name - returns username or truncated publicKey
UserSchema.virtual('displayName').get(function() {
  if (this.username && typeof this.username === 'string' && this.username.trim()) {
    return this.username;
  }
  // Return truncated public key if no username
  const publicKey = this.publicKey as string | undefined;
  if (publicKey && typeof publicKey === 'string') {
    if (publicKey.startsWith('0x')) {
      return `0x${publicKey.slice(2, 8)}...${publicKey.slice(-6)}`;
    }
    return `${publicKey.slice(0, 6)}...${publicKey.slice(-6)}`;
  }
  return 'Anonymous';
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
