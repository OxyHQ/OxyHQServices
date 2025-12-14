/**
 * User Types
 * 
 * Centralized type definitions for user-related operations.
 * Reuses model types to avoid duplication.
 */

import { Types } from 'mongoose';
import { IUser } from '../models/User';

// Reuse name structure from IUser
export type UserName = IUser['name'];

// User profile data for API responses (read-only, excludes sensitive fields)
export type UserProfile = Pick<
  IUser,
  | '_id'
  | 'username'
  | 'name'
  | 'avatar'
  | 'bio'
  | 'description'
  | 'links'
  | 'linksMetadata'
  | 'verified'
  | 'createdAt'
  | 'updatedAt'
>;

// Fields allowed for profile updates
export type ProfileUpdateInput = Partial<
  Pick<
    IUser,
    | 'name'
    | 'email'
    | 'username'
    | 'avatar'
    | 'bio'
    | 'description'
    | 'links'
    | 'linksMetadata'
    | 'locations'
    | 'language'
    | 'accountExpiresAfterInactivityDays'
  >
>;

// User statistics
export interface UserStatistics {
  followers: number;
  following: number;
  karma: number;
}

// Pagination parameters
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

// Paginated response
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

// Follow action result
export interface FollowActionResult {
  action: 'follow' | 'unfollow';
  counts: {
    followers: number;
    following: number;
  };
}

