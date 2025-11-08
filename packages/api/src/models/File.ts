import mongoose, { Schema, Document } from 'mongoose';

/**
 * File visibility levels
 * - private: Only accessible by owner (default)
 * - public: Accessible by anyone without authentication (e.g., avatars, public profile content)
 * - unlisted: Accessible with direct link but not listed publicly
 */
export type FileVisibility = 'private' | 'public' | 'unlisted';

export interface IFileLink {
  app: string;
  entityType: string;
  entityId: string;
  createdBy: string;
  createdAt: Date;
  // Optional webhook URL provided by third-party apps to receive file events
  webhookUrl?: string;
}

export interface IFileVariant {
  type: string;
  key: string;
  width?: number;
  height?: number;
  readyAt?: Date;
  size?: number;
  metadata?: Record<string, any>;
}

export interface IFile extends Document {
  _id: string;
  sha256: string;
  size: number;
  mime: string;
  ext: string;
  ownerUserId: string;
  status: 'active' | 'trash' | 'deleted';
  visibility: FileVisibility;
  createdAt: Date;
  updatedAt: Date;
  links: IFileLink[];
  variants: IFileVariant[];
  
  // Virtual property for usage count
  usageCount: number;
  
  // Storage information
  storageKey: string;
  originalName?: string;
  metadata?: Record<string, any>;
}

const FileLinkSchema = new Schema<IFileLink>({
  app: { type: String, required: true, index: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: String, required: true, index: true },
  createdBy: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  webhookUrl: { type: String }
}, { _id: false });

const FileVariantSchema = new Schema<IFileVariant>({
  type: { type: String, required: true },
  key: { type: String, required: true },
  width: { type: Number },
  height: { type: Number },
  readyAt: { type: Date },
  size: { type: Number },
  metadata: { type: Schema.Types.Mixed }
}, { _id: false });

const FileSchema = new Schema<IFile>({
  sha256: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  size: { type: Number, required: true },
  mime: { type: String, required: true, index: true },
  ext: { type: String, required: true },
  ownerUserId: { 
    type: String, 
    required: true, 
    index: true 
  },
  status: { 
    type: String, 
    enum: ['active', 'trash', 'deleted'], 
    default: 'active',
    index: true 
  },
  visibility: {
    type: String,
    enum: ['private', 'public', 'unlisted'],
    default: 'private',
    index: true
  },
  links: [FileLinkSchema],
  variants: [FileVariantSchema],
  storageKey: { type: String, required: true },
  originalName: { type: String },
  metadata: { type: Schema.Types.Mixed }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for usage count
FileSchema.virtual('usageCount').get(function() {
  return this.links.length;
});

// Compound indexes for efficient queries
FileSchema.index({ ownerUserId: 1, status: 1 });
FileSchema.index({ ownerUserId: 1, visibility: 1, status: 1 });
FileSchema.index({ visibility: 1, status: 1 }); // For public file queries
FileSchema.index({ 'links.app': 1, 'links.entityType': 1, 'links.entityId': 1 });
FileSchema.index({ sha256: 1, status: 1 });
FileSchema.index({ createdAt: -1 });

// Index for efficient link queries
FileSchema.index({ 
  'links.app': 1, 
  'links.entityType': 1, 
  'links.entityId': 1, 
  'links.createdBy': 1 
});

export const File = mongoose.model<IFile>('File', FileSchema);