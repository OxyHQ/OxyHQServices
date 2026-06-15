import mongoose, { Schema, Document } from 'mongoose';

export const WORKSPACE_TYPES = ['personal', 'team'] as const;

export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export const WORKSPACE_STATUSES = ['active', 'deleted'] as const;

export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

// Re-export the role tuple/type so consumers can import everything workspace
// related from the model, mirroring how ApplicationMember re-exposes roles.
export { WORKSPACE_ROLES, type WorkspaceRole } from '../utils/workspaceRoles';

export interface IWorkspace extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  name: string;
  /**
   * URL-safe, lowercase, globally unique identifier derived from `name` at
   * creation time. Stable for the lifetime of the workspace (renaming the
   * workspace does NOT re-generate the slug).
   */
  slug: string;
  /**
   * `personal` workspaces are auto-provisioned, exactly one per user, and can
   * never be deleted. `team` workspaces are user-created and deletable (when
   * empty). Defaults to `team`.
   */
  type: WorkspaceType;
  description?: string;
  icon?: string;
  /** User who owns the workspace — automatically granted the `owner` member role. */
  ownerId: mongoose.Types.ObjectId;
  status: WorkspaceStatus;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSchema = new Schema<IWorkspace>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    type: {
      type: String,
      enum: WORKSPACE_TYPES,
      default: 'team',
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    icon: {
      type: String,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: WORKSPACE_STATUSES,
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

WorkspaceSchema.index({ ownerId: 1, status: 1 });
WorkspaceSchema.index({ ownerId: 1, type: 1 });
WorkspaceSchema.index({ createdAt: -1 });

export const Workspace = mongoose.model<IWorkspace>('Workspace', WorkspaceSchema);

export default Workspace;
