/**
 * OxyHQ Services Redux Store
 * Framework-agnostic, tree-shakable Redux integration
 * 
 * This module exports individual slices, reducers, actions, selectors, and helpers
 * for easy integration into any Redux store without internal dependencies.
 */

// Export individual slices and their components
export * from './slices';

// Export setup helper for easy integration
export { setupOxyStore, oxyReducers } from './setupOxyStore';

// Export types for external store integration
export type { AuthState, FollowState } from './slices/types';

// For backward compatibility: create a legacy store instance
// This will be deprecated in favor of setupOxyStore()
import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore } from './setupOxyStore';

/**
 * @deprecated Use setupOxyStore() instead to integrate with your app's store
 * This internal store will be removed in a future version
 */
export const store = configureStore({
  reducer: setupOxyStore(),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Legacy selector (deprecated)
export const selectIsUserBeingFetched = (state: RootState, userId: string) => 
  state.follow.fetchingUsers[userId] ?? false;
