import { authReducer } from './slices/authSlice';
import { followReducer } from './slices/followSlice';

/**
 * Setup helper for Oxy Store
 * Returns all Oxy reducers ready to be spread into a host app's Redux store
 * 
 * Usage:
 * ```ts
 * const store = configureStore({
 *   reducer: {
 *     ...setupOxyStore(),
 *     appSpecificReducer,
 *   },
 * });
 * ```
 */
export function setupOxyStore() {
  return {
    auth: authReducer,
    follow: followReducer,
  };
}

/**
 * Tree-shakable version where you can pick specific reducers
 * 
 * Usage:
 * ```ts
 * const store = configureStore({
 *   reducer: {
 *     ...setupOxyStore.pick('auth'), // Only include auth
 *     // or
 *     ...setupOxyStore.pick('auth', 'follow'), // Include both
 *     appSpecificReducer,
 *   },
 * });
 * ```
 */
setupOxyStore.pick = function(...keys: Array<'auth' | 'follow'>) {
  const allReducers = setupOxyStore();
  const pickedReducers = {} as Partial<ReturnType<typeof setupOxyStore>>;
  
  for (const key of keys) {
    if (key in allReducers) {
      // Use bracket notation with explicit typing
      (pickedReducers as Record<string, any>)[key] = allReducers[key];
    }
  }
  
  return pickedReducers;
};

// Export individual reducers for maximum flexibility
export const oxyReducers = {
  auth: authReducer,
  follow: followReducer,
};