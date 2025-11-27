/**
 * Utilities for normalizing user objects across controllers and utilities.
 * Ensures we consistently return an `id` field and a `name.full` value,
 * regardless of whether the source is a Mongoose document or a lean object.
 */

import type { IUser } from '../models/User';

type UserLike = Partial<IUser> & {
  _id?: string | { toString(): string };
  id?: string;
  toObject?: () => any;
};

interface NormalizeUserOptions {
  /**
   * Keep the raw `_id` value on the returned object.
   * Useful for internal use when both `_id` and `id` are required.
   */
  keepMongoId?: boolean;
}

/**
 * Normalize a user-like object into a plain response-friendly shape.
 */
export function normalizeUser(user: UserLike | null | undefined, options: NormalizeUserOptions = {}) {
  if (!user) {
    return null;
  }

  const raw = typeof user.toObject === 'function' ? user.toObject() : { ...user };

  const id = raw.id || normalizeId(raw._id);
  const name = normalizeName(raw.name);

  const normalized: Record<string, any> = {
    ...raw,
    id,
    name,
  };

  if (!options.keepMongoId && '_id' in normalized) {
    delete normalized._id;
  }

  return normalized;
}

function normalizeId(id: any): string | undefined {
  if (!id) return undefined;
  if (typeof id === 'string') return id;
  if (typeof id.toString === 'function') return id.toString();
  return undefined;
}

function normalizeName(name: any) {
  if (!name || typeof name !== 'object') {
    return name;
  }

  const first = typeof name.first === 'string' ? name.first : '';
  const last = typeof name.last === 'string' ? name.last : '';
  const full =
    typeof name.full === 'string' && name.full.length > 0
      ? name.full
      : [first, last].filter(Boolean).join(' ').trim() || undefined;

  return { ...name, full };
}
