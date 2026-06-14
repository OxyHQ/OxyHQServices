import mongoose, { Schema, Document } from 'mongoose';
import { APPLICATION_ROLES, type ApplicationRole } from '../utils/applicationRoles';

export const APPLICATION_MEMBER_STATUSES = ['active', 'invited', 'removed'] as const;

export type ApplicationMemberStatus = (typeof APPLICATION_MEMBER_STATUSES)[number];

export interface IApplicationMember extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  applicationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  role: ApplicationRole;
  /** Derived from `role` at write time via `permissionsForRole`. */
  permissions: string[];
  invitedByUserId?: mongoose.Types.ObjectId;
  joinedAt?: Date;
  status: ApplicationMemberStatus;
  createdAt: Date;
  updatedAt: Date;
}

const ApplicationMemberSchema = new Schema<IApplicationMember>(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
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
      enum: APPLICATION_ROLES,
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
      enum: APPLICATION_MEMBER_STATUSES,
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

// A user can hold at most one membership row per application.
ApplicationMemberSchema.index({ applicationId: 1, userId: 1 }, { unique: true });

export const ApplicationMember = mongoose.model<IApplicationMember>(
  'ApplicationMember',
  ApplicationMemberSchema
);

export default ApplicationMember;
