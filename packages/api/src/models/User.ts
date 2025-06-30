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
    middle?: string;
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
  labels?: string[];
  bio?: string;
  description?: string;
  coverPhoto?: string;
  location?: string;
  website?: string;
  links?: {
    url: string;
    title?: string | null;
    description?: string | null;
    image?: string | null;
  }[];
  pinnedPost?: {
    cid?: string;
    uri?: string;
  };
  _count?: {
    followers?: number;
    following?: number;
    posts?: number;
    karma?: number;
  };
  lastSeen: Date;
  isOnline: boolean;
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
      lowercase: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9_]+$/,
      index: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 5,
      maxlength: 255,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      index: true
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
      maxlength: 128,
      select: false
    },
    refreshToken: {
      type: String,
      default: null,
      select: false
    },
    bookmarks: [{
      type: Schema.Types.ObjectId,
      ref: "Post",
      default: [],
      index: true
    }],
    following: [{
      type: Schema.Types.ObjectId,
      ref: "User",
      default: [],
      index: true
    }],
    followers: [{
      type: Schema.Types.ObjectId,
      ref: "User",
      default: [],
      index: true
    }],
    name: {
      first: { 
        type: String, 
        trim: true, 
        maxlength: 50 
      },
      middle: { 
        type: String, 
        trim: true, 
        maxlength: 50 
      },
      last: { 
        type: String, 
        trim: true, 
        maxlength: 50 
      }
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
      muteKeywords: { type: Boolean, default: false }
    },
    avatar: {
      id: { type: String, default: "" },
      url: { type: String, default: "" }
    },
    associated: {
      lists: { type: Number, default: 0 },
      feedgens: { type: Number, default: 0 },
      starterPacks: { type: Number, default: 0 },
      labeler: { type: Boolean, default: false }
    },
    labels: { 
      type: [String], 
      default: [],
      index: true
    },
    bio: { 
      type: String, 
      maxlength: 500,
      trim: true
    },
    description: { 
      type: String, 
      maxlength: 1000,
      trim: true
    },
    coverPhoto: { type: String },
    location: { 
      type: String, 
      maxlength: 100,
      trim: true
    },
    website: { 
      type: String, 
      maxlength: 255,
      trim: true
    },
    links: {
      type: [{
        url: { type: String, required: true },
        title: { type: String },
        description: { type: String },
        image: { type: String }
      }],
      default: []
    },
    pinnedPosts: [{ 
      type: Schema.Types.ObjectId, 
      ref: "Post", 
      default: [] 
    }],
    lastSeen: {
      type: Date,
      default: Date.now,
      index: true
    },
    isOnline: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: true,
    strict: true,
    validateBeforeSave: true
  }
);

UserSchema.index({ username: 1, email: 1 });
UserSchema.index({ 'privacySettings.isPrivateAccount': 1, createdAt: -1 });
UserSchema.index({ isOnline: 1, lastSeen: -1 });
UserSchema.index({ followers: 1, createdAt: -1 });
UserSchema.index({ following: 1, createdAt: -1 });

UserSchema.index({
  username: 'text',
  'name.first': 'text',
  'name.middle': 'text',
  'name.last': 'text',
  bio: 'text',
  description: 'text',
  location: 'text'
}, {
  weights: {
    username: 10,
    'name.first': 8,
    'name.middle': 8,
    'name.last': 8,
    bio: 5,
    description: 3,
    location: 2
  },
  name: 'user_search_index'
});

UserSchema.set("toJSON", {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.refreshToken;
    
    if (ret.name) {
      const { first, middle, last } = ret.name;
      ret.name.full = [first, middle, last].filter(Boolean).join(" ");
    }
    
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    
    return ret;
  },
  versionKey: false
});

UserSchema.virtual('name.full').get(function() {
  const name = this.name as { first?: string; middle?: string; last?: string } | undefined;
  if (!name) return undefined;
  return [name.first, name.middle, name.last].filter(Boolean).join(' ');
});

UserSchema.pre("save", function (next) {
  if (this.isModified('username') && typeof this.username === 'string') {
    this.username = this.username.toLowerCase();
  }
  
  if (this.isModified('email') && typeof this.email === 'string') {
    this.email = this.email.toLowerCase();
  }
  
  this.lastSeen = new Date();
  
  next();
});

UserSchema.virtual('fullName').get(function() {
  const name = this.name as { first?: string; middle?: string; last?: string } | undefined;
  if (name) {
    const full = [name.first, name.middle, name.last].filter(Boolean).join(' ');
    if (full) return full;
  }
  return this.username;
});

UserSchema.virtual('displayName').get(function() {
  return this.fullName || this.username;
});

UserSchema.statics.findByUsername = function(username: string) {
  return this.findOne({ username: username.toLowerCase() });
};

UserSchema.statics.findByEmail = function(email: string) {
  return this.findOne({ email: email.toLowerCase() });
};

UserSchema.statics.searchUsers = function(query: string, limit: number = 20) {
  return this.find(
    { $text: { $search: query } },
    { score: { $meta: "textScore" } }
  )
  .sort({ score: { $meta: "textScore" } })
  .limit(limit)
  .select('-password -refreshToken');
};

UserSchema.methods.updateOnlineStatus = function(isOnline: boolean) {
  this.isOnline = isOnline;
  this.lastSeen = new Date();
  return this.save();
};

UserSchema.methods.addFollower = function(followerId: mongoose.Types.ObjectId) {
  if (!this.followers.includes(followerId)) {
    this.followers.push(followerId);
    return this.save();
  }
  return Promise.resolve(this);
};

UserSchema.methods.removeFollower = function(followerId: mongoose.Types.ObjectId) {
  this.followers = this.followers.filter((id: mongoose.Types.ObjectId) => !id.equals(followerId));
  return this.save();
};

UserSchema.methods.followUser = function(userId: mongoose.Types.ObjectId) {
  if (!this.following.includes(userId)) {
    this.following.push(userId);
    return this.save();
  }
  return Promise.resolve(this);
};

UserSchema.methods.unfollowUser = function(userId: mongoose.Types.ObjectId) {
  this.following = this.following.filter((id: mongoose.Types.ObjectId) => !id.equals(userId));
  return this.save();
};

const User = mongoose.model<IUser>("User", UserSchema);

export default User;