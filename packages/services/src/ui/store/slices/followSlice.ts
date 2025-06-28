import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import type { FollowState } from './types';
import { initialFollowState } from './types';

// Define thunk state interface for dependency injection
interface RootState {
  follow: FollowState;
}

// Async thunk for fetching follow status from backend with deduplication
export const fetchFollowStatus = createAsyncThunk(
  'follow/fetchFollowStatus',
  async ({ userId, oxyServices }: { userId: string; oxyServices: any }, { rejectWithValue }) => {
    try {
      // Use the proper core service method
      const response = await oxyServices.getFollowStatus(userId);
      return { userId, isFollowing: response.isFollowing };
    } catch (error: any) {
      // Ignore authentication errors when user isn't signed in - don't update state
      if (error?.status === 401 || error?.message?.includes('Authentication')) {
        return rejectWithValue('Not authenticated');
      }
      // Log other failures and reject to not update state
      console.warn(`Failed to fetch follow status for user ${userId}:`, error);
      return rejectWithValue(error?.message || 'Failed to fetch follow status');
    }
  },
  {
    // Prevent duplicate requests for the same user ID
    condition: ({ userId }, { getState }) => {
      const state = getState() as RootState;
      const isAlreadyFetching = state.follow.fetchingUsers[userId];
      
      if (isAlreadyFetching) {
        console.log(`⚡ Deduplicating fetch request for user ${userId} - already in progress`);
        return false; // Cancel this request
      }
      
      return true; // Allow this request
    }
  }
);

// Async thunk for following/unfollowing users using core services
export const toggleFollowUser = createAsyncThunk(
  'follow/toggleFollowUser',
  async ({ userId, oxyServices, isCurrentlyFollowing }: { 
    userId: string; 
    oxyServices: any; 
    isCurrentlyFollowing: boolean; 
  }, { rejectWithValue, dispatch }) => {
    try {
      let response: { success?: boolean; message?: string; action?: string };
      let newFollowState: boolean;

      if (isCurrentlyFollowing) {
        // Use the core service to unfollow user
        response = await oxyServices.unfollowUser(userId);
        newFollowState = false;
      } else {
        // Use the core service to follow user
        response = await oxyServices.followUser(userId);
        newFollowState = true;
      }

      // Check if the response indicates success (different APIs might return different formats)
      const isSuccess = response.success !== false && response.action !== 'error';
      
      if (isSuccess) {
        return { 
          userId, 
          isFollowing: newFollowState, 
          message: response.message || `Successfully ${newFollowState ? 'followed' : 'unfollowed'} user` 
        };
      } else {
        return rejectWithValue(response.message || `Failed to ${newFollowState ? 'follow' : 'unfollow'} user`);
      }
    } catch (error: any) {
      // Enhanced error handling with state mismatch detection
      let errorMessage = 'Network error occurred';
      
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error?.data?.message) {
        errorMessage = error.data.message;
      }

      // Handle state mismatch errors by syncing with backend
      if (errorMessage.includes('Not following this user') && isCurrentlyFollowing) {
        console.warn(`State mismatch detected for user ${userId}: Frontend thinks following, backend says not following. Syncing state...`);
        // Auto-sync with backend state
        try {
          const actualStatus = await oxyServices.getFollowStatus(userId);
          dispatch({ type: 'follow/setFollowingStatus', payload: { userId, isFollowing: actualStatus.isFollowing } });
          return rejectWithValue('State synced with backend. Please try again.');
        } catch (syncError) {
          console.error('Failed to sync state with backend:', syncError);
        }
      } else if (errorMessage.includes('Already following this user') && !isCurrentlyFollowing) {
        console.warn(`State mismatch detected for user ${userId}: Frontend thinks not following, backend says following. Syncing state...`);
        // Auto-sync with backend state
        try {
          const actualStatus = await oxyServices.getFollowStatus(userId);
          dispatch({ type: 'follow/setFollowingStatus', payload: { userId, isFollowing: actualStatus.isFollowing } });
          return rejectWithValue('State synced with backend. Please try again.');
        } catch (syncError) {
          console.error('Failed to sync state with backend:', syncError);
        }
      }
      
      return rejectWithValue(errorMessage);
    }
  }
);

export const followSlice = createSlice({
  name: 'follow',
  initialState: initialFollowState,
  reducers: {
    setFollowingStatus(state: FollowState, action: PayloadAction<{ userId: string; isFollowing: boolean }>) {
      const { userId, isFollowing } = action.payload;
      state.followingUsers[userId] = isFollowing;
      state.errors[userId] = null;
    },
    clearFollowError(state: FollowState, action: PayloadAction<string>) {
      const userId = action.payload;
      state.errors[userId] = null;
    },
    resetFollowState(state: FollowState) {
      state.followingUsers = {};
      state.loadingUsers = {};
      state.fetchingUsers = {};
      state.errors = {};
    },
  },
  extraReducers: (builder) => {
    builder
      // Handle fetchFollowStatus
      .addCase(fetchFollowStatus.pending, (state, action) => {
        const { userId } = action.meta.arg;
        state.fetchingUsers[userId] = true;
        state.errors[userId] = null;
      })
      .addCase(fetchFollowStatus.fulfilled, (state, action) => {
        const { userId, isFollowing } = action.payload;
        state.followingUsers[userId] = isFollowing;
        state.fetchingUsers[userId] = false;
        state.errors[userId] = null;
      })
      .addCase(fetchFollowStatus.rejected, (state, action) => {
        const { userId } = action.meta.arg;
        state.fetchingUsers[userId] = false;
        // Don't update follow state on fetch errors - preserve existing/initial state
        if (action.payload !== 'Not authenticated') {
          console.warn(`Failed to fetch follow status for user ${userId}:`, action.payload);
        }
      })
      // Handle toggleFollowUser
      .addCase(toggleFollowUser.pending, (state, action) => {
        const { userId } = action.meta.arg;
        state.loadingUsers[userId] = true;
        state.errors[userId] = null;
      })
      .addCase(toggleFollowUser.fulfilled, (state, action) => {
        const { userId, isFollowing } = action.payload;
        state.followingUsers[userId] = isFollowing;
        state.loadingUsers[userId] = false;
        state.errors[userId] = null;
      })
      .addCase(toggleFollowUser.rejected, (state, action) => {
        const { userId } = action.meta.arg;
        state.loadingUsers[userId] = false;
        state.errors[userId] = action.error.message || 'Failed to update follow status';
      });
  },
});

// Export actions
export const followActions = followSlice.actions;
export const { setFollowingStatus, clearFollowError, resetFollowState } = followSlice.actions;

// Export thunks
export const followThunks = {
  fetchFollowStatus,
  toggleFollowUser,
};

// Export selectors
export const followSelectors = {
  selectFollowingUsers: (state: { follow: FollowState }) => state.follow.followingUsers,
  selectLoadingUsers: (state: { follow: FollowState }) => state.follow.loadingUsers,
  selectFetchingUsers: (state: { follow: FollowState }) => state.follow.fetchingUsers,
  selectFollowErrors: (state: { follow: FollowState }) => state.follow.errors,
  selectIsUserFollowed: (state: { follow: FollowState }, userId: string) => 
    state.follow.followingUsers[userId] ?? false,
  selectIsUserLoading: (state: { follow: FollowState }, userId: string) => 
    state.follow.loadingUsers[userId] ?? false,
  selectIsUserBeingFetched: (state: { follow: FollowState }, userId: string) => 
    state.follow.fetchingUsers[userId] ?? false,
  selectUserError: (state: { follow: FollowState }, userId: string) => 
    state.follow.errors[userId] ?? null,
};

// Export reducer
export const followReducer = followSlice.reducer;