import mongoose, { Schema, type Document } from 'mongoose';
import { ACCOUNT_ROLES, type AccountRole } from '../utils/accountRoles';

export const ACCOUNT_MEMBER_STATUSES = ['active', 'invited', 'removed'] as const;

export type AccountMemberStatus = (typeof ACCOUNT_MEMBER_STATUSES)[number];

/**
 * Membership of a member (a `personal` User) on an account (any-kind User in the
 * account graph). A single `AccountMember` table replaces the legacy
 * `WorkspaceMember` + `ApplicationMember` + `ManagedAccount.managers[]` tables.
 *
 * Membership cascades down the tree: a row on an ancestor account grants the
 * member access to the entire subtree UNLESS `inherit` is false (opt-out for a
 * single node) or a nearer row overrides it. The nearest membership row over
 * `[accountId, ...account.ancestors]` wins (a direct row on `accountId` always
 * beats any inherited one) — see `account.service.ts` `resolveEffectiveRole`.
 */
export interface IAccountMember extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  /** The account this membership is on (a User `_id`, any `kind`). */
  accountId: mongoose.Types.ObjectId;
  /** The member (a `personal` User `_id`). */
  memberUserId: mongoose.Types.ObjectId;
  role: AccountRole;
  /** Derived from `role` at write time via `permissionsForAccountRole`. */
  permissions: string[];
  /**
   * Whether this membership cascades to descendant accounts. `true` (default)
   * grants access to the whole subtree below `accountId`; `false` scopes it to
   * `accountId` alone (the member is NOT a member of its children).
   */
  inherit: boolean;
  status: AccountMemberStatus;
  invitedByUserId?: mongoose.Types.ObjectId;
  joinedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AccountMemberSchema = new Schema<IAccountMember>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    memberUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ACCOUNT_ROLES,
      required: true,
    },
    permissions: {
      type: [String],
      default: [],
    },
    inherit: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ACCOUNT_MEMBER_STATUSES,
      default: 'active',
    },
    invitedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    joinedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// A user can hold at most one membership row per account.
AccountMemberSchema.index({ accountId: 1, memberUserId: 1 }, { unique: true });
// Fast "what can this user reach" lookups (drives listAccessibleAccounts).
AccountMemberSchema.index({ memberUserId: 1, status: 1 });

export const AccountMember = mongoose.model<IAccountMember>(
  'AccountMember',
  AccountMemberSchema
);

export default AccountMember;
