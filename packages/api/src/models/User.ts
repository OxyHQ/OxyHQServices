import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  username: string;
  email: string;
  password: string;
  refreshToken?: string | null;
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
    twoFactorEnabled: boolean;
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
      required: true,
      unique: true,
      trim: true,
      select: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      select: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
      set: (v: string) => v,
    },
    refreshToken: {
      type: String,
      default: null,
      select: false,
    },
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
      twoFactorEnabled: { type: Boolean, default: false },
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
  },
  {
    timestamps: true,
    strict: true,
    validateBeforeSave: true,
  }
);

// Remove transforms and rely on select options
UserSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
});

UserSchema.set("toObject", {
  virtuals: true,
});

// Only create indexes for fields that don't have unique: true in schema
UserSchema.index({ following: 1 });
UserSchema.index({ followers: 1 });

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
