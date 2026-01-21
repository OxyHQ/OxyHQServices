/**
 * Simple utility to format user objects for API responses.
 * Returns clean, explicit user object with id (MongoDB ObjectId) and publicKey as separate fields.
 */

import type { IUser } from '../models/User';

type UserLike = IUser | { _id: any; [key: string]: any } | null | undefined;

/**
 * Format user object for API response.
 * id = MongoDB ObjectId (_id.toString())
 * publicKey = separate field for authentication
 */
export function formatUserResponse(user: UserLike) {
  if (!user) {
    return null;
  }

  const userId = user._id?.toString();
  if (!userId) {
    return null;
  }

  return {
    id: userId,
    publicKey: user.publicKey,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    name: user.name,
    privacySettings: user.privacySettings,
    verified: user.verified,
    language: user.language,
    bio: user.bio,
    description: user.description,
    locations: user.locations,
    links: user.links,
    linksMetadata: user.linksMetadata,
  };
}

/**
 * Legacy function - redirects to formatUserResponse for backwards compatibility.
 * @deprecated Use formatUserResponse instead
 */
export function normalizeUser(user: UserLike) {
  return formatUserResponse(user);
}
