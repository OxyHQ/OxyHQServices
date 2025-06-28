import type { User } from '../../../models/interfaces';

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface FollowState {
  // Track follow status for each user ID
  followingUsers: Record<string, boolean>;
  // Track loading state for each user ID
  loadingUsers: Record<string, boolean>;
  // Track which user IDs are currently being fetched (to prevent duplicate requests)
  fetchingUsers: Record<string, boolean>;
  // Track any follow/unfollow errors
  errors: Record<string, string | null>;
}

export const initialAuthState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
};

export const initialFollowState: FollowState = {
  followingUsers: {},
  loadingUsers: {},
  fetchingUsers: {},
  errors: {},
};