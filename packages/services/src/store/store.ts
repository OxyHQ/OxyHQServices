import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
// Import other reducers here if you have them

const store = configureStore({
  reducer: {
    auth: authReducer,
    // other reducers can be added here
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types, warning due to OxyServices instance
        ignoredActions: ['auth/initAuth/fulfilled', 'auth/setOxyServices'],
        // Ignore these paths in the state
        ignoredPaths: ['auth.oxyServices'],
      },
    }),
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
