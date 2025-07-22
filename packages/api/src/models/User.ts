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
  };
  privacySettings: {
    isPrivateAccount: boolean;
    hideOnlineStatus: boolean;
    hideLastSeen: boolean;
    profileVisibility: boolean;
    postVisibility: boolean;
    twoFactorEnabled: boolean;
    loginAlerts: boolean;
    blockScreenshots: boolean;
    secureLogin: boolean;
    biometricLogin: boolean;
    showActivity: boolean;
    allowTagging: boolean;
    allowMentions: boolean;
    hideReadReceipts: boolean;
    allowComments: boolean;
    allowDirectMessages: boolean;
    dataSharing: boolean;
    locationSharing: boolean;
    analyticsSharing: boolean;
    sensitiveContent: boolean;
    autoFilter: boolean;
    muteKeywords: boolean;
  };
  avatar?: {
    id?: string;
    url?: string;
    [key: string]: any;
  };
  _count?: {
    followers?: number;
    following?: number;
  };
  bio?: string;
  description?: string;
  location?: string;
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
}

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
    name: {
      first: { type: String, default: "" },
      last: { type: String, default: "" },
    },
    privacySettings: {
      isPrivateAccount: { type: Boolean, default: false },
      hideOnlineStatus: { type: Boolean, default: false },
      hideLastSeen: { type: Boolean, default: false },
      profileVisibility: { type: Boolean, default: true },
      postVisibility: { type: Boolean, default: true },
      twoFactorEnabled: { type: Boolean, default: false },
      loginAlerts: { type: Boolean, default: true },
      blockScreenshots: { type: Boolean, default: false },
      secureLogin: { type: Boolean, default: true },
      biometricLogin: { type: Boolean, default: false },
      showActivity: { type: Boolean, default: true },
      allowTagging: { type: Boolean, default: true },
      allowMentions: { type: Boolean, default: true },
      hideReadReceipts: { type: Boolean, default: false },
      allowComments: { type: Boolean, default: true },
      allowDirectMessages: { type: Boolean, default: true },
      dataSharing: { type: Boolean, default: true },
      locationSharing: { type: Boolean, default: false },
      analyticsSharing: { type: Boolean, default: true },
      sensitiveContent: { type: Boolean, default: false },
      autoFilter: { type: Boolean, default: true },
      muteKeywords: { type: Boolean, default: false },
    },
    avatar: {
      type: {
        id: { type: String, default: "" },
        url: { type: String, default: "" }
      },
      default: { id: "", url: "" }
    },
    _count: {
      followers: { type: Number, default: 0 },
      following: { type: Number, default: 0 },
    },
    bio: { type: String },
    description: { type: String },
    location: { type: String },
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
  transform: function (doc, ret) {
    return ret;
  },
  versionKey: false,
});

UserSchema.set("toObject", {
  virtuals: true,
});

// Add a save middleware to ensure password is included
UserSchema.pre("save", function (next) {
  console.log("Saving user document:", {
    hasUsername: !!this.username,
    hasEmail: !!this.email,
    hasPassword: !!this.password,
    fields: Object.keys(this.toObject()),
  });
  next();
});

// Only create indexes for fields that don't have unique: true in schema
UserSchema.index({ following: 1 });
UserSchema.index({ followers: 1 });

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

export const User = mongoose.model<IUser>('User', UserSchema);
export default User;