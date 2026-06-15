import mongoose, { Schema, Document } from 'mongoose';
import { WORKSPACE_ROLES, type WorkspaceRole } from '../utils/workspaceRoles';

export const WORKSPACE_MEMBER_STATUSES = ['active', 'invited', 'removed'] as const;

export type WorkspaceMemberStatus = (typeof WORKSPACE_MEMBER_STATUSES)[number];

export interface IWorkspaceMember extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  role: WorkspaceRole;
  /** Derived from `role` at write time via `permissionsForRole`. */
  permissions: string[];
  invitedByUserId?: mongoose.Types.ObjectId;
  joinedAt?: Date;
  status: WorkspaceMemberStatus;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceMemberSchema = new Schema<IWorkspaceMember>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: WORKSPACE_ROLES,
      required: true,
    },
    permissions: {
      type: [String],
      default: [],
    },
    invitedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    joinedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: WORKSPACE_MEMBER_STATUSES,
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

// A user can hold at most one membership row per workspace.
WorkspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export const WorkspaceMember = mongoose.model<IWorkspaceMember>(
  'WorkspaceMember',
  WorkspaceMemberSchema
);

export default WorkspaceMember;
