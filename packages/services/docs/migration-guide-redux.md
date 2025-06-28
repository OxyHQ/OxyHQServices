# Migration Guide - Redux Refactoring

This guide helps you migrate from the old internal store architecture to the new framework-agnostic Redux integration.

## Summary of Changes

### ✅ What's New
- `setupOxyStore()` helper for easy integration
- Tree-shakable reducers with `setupOxyStore.pick()`
- Individual slice exports (`authSlice`, `followSlice`)
- Individual reducer exports (`authReducer`, `followReducer`)
- Framework-agnostic hooks (`useOxyFollow`)
- Better TypeScript support

### ⚠️ Breaking Changes
- Internal Redux store removed
- `OxyProvider` now requires external Redux Provider
- Some internal APIs changed

### 🔄 Backward Compatibility
- Legacy `store` export still available (deprecated)
- `useFollow` hook still works
- `OxyProvider` still works with `contextOnly={true}`

## Migration Steps

### Step 1: Update Your Store Configuration

**Before:**
```tsx
import { OxyProvider } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider oxyServices={oxyServices}>
      <YourApp />
    </OxyProvider>
  );
}
```

**After:**
```tsx
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore, OxyContextProvider } from '@oxyhq/services';

// Create your app store
const store = configureStore({
  reducer: {
    ...setupOxyStore(),
    // Your existing reducers
    yourAppReducer,
  },
});

function App() {
  return (
    <Provider store={store}>
      <OxyContextProvider oxyServices={oxyServices}>
        <YourApp />
      </OxyContextProvider>
    </Provider>
  );
}
```

### Step 2: Update Redux Types (TypeScript)

**Before:**
```tsx
import type { RootState, AppDispatch } from '@oxyhq/services';
```

**After:**
```tsx
import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore } from '@oxyhq/services';

const store = configureStore({
  reducer: {
    ...setupOxyStore(),
    // Your reducers
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

### Step 3: Update Hook Imports (Recommended)

**Before:**
```tsx
import { useFollow } from '@oxyhq/services';
```

**After:**
```tsx
import { useOxyFollow } from '@oxyhq/services';
// or keep using useFollow - it still works
```

### Step 4: Update Direct Store Usage (If Any)

**Before:**
```tsx
import { store } from '@oxyhq/services';
```

**After:**
```tsx
// Use your app's store instead
import { store } from './store'; // Your app's store
```

## Advanced Migration Scenarios

### Scenario 1: Existing Redux Store

If you already have a Redux store in your app:

```tsx
// Your existing store
const store = configureStore({
  reducer: {
    existingFeature: existingReducer,
    anotherFeature: anotherReducer,
  },
});

// Add Oxy reducers
const enhancedStore = configureStore({
  reducer: {
    ...setupOxyStore(), // Add Oxy features
    existingFeature: existingReducer,
    anotherFeature: anotherReducer,
  },
});
```

### Scenario 2: Tree-Shaking for Large Apps

If you only need specific Oxy features:

```tsx
// Only include auth functionality
const store = configureStore({
  reducer: {
    ...setupOxyStore.pick('auth'),
    yourFeatures: yourReducer,
  },
});

// Or individual reducers
import { authReducer } from '@oxyhq/services';

const store = configureStore({
  reducer: {
    oxyAuth: authReducer, // Custom key name
    yourFeatures: yourReducer,
  },
});
```

### Scenario 3: Multiple App Integration

For apps in the Oxy ecosystem (Mention, Marketplace, OxyPay):

```tsx
// mention-app/store.ts
const mentionStore = configureStore({
  reducer: {
    ...setupOxyStore(),
    mention: mentionReducer,
    messaging: messagingReducer,
  },
});

// marketplace-app/store.ts  
const marketplaceStore = configureStore({
  reducer: {
    ...setupOxyStore(),
    products: productsReducer,
    cart: cartReducer,
  },
});

// oxypay-app/store.ts
const oxyPayStore = configureStore({
  reducer: {
    ...setupOxyStore.pick('auth'), // Only need auth
    payments: paymentsReducer,
    transactions: transactionsReducer,
  },
});
```

## Component Migration Examples

### Auth Components

**Before:**
```tsx
import { useSelector } from 'react-redux';
import type { RootState } from '@oxyhq/services';

function AuthStatus() {
  const user = useSelector((state: RootState) => state.auth.user);
  // ...
}
```

**After:**
```tsx
import { useSelector } from 'react-redux';
import { authSelectors } from '@oxyhq/services';
import type { RootState } from '../store'; // Your app's RootState

function AuthStatus() {
  const user = useSelector(authSelectors.selectUser);
  // ...
}
```

### Follow Components

**Before:**
```tsx
import { useFollow } from '@oxyhq/services';

function FollowButton({ userId }) {
  const { isFollowing, toggleFollow } = useFollow(userId);
  // ...
}
```

**After:**
```tsx
import { useOxyFollow } from '@oxyhq/services';

function FollowButton({ userId }) {
  const { isFollowing, toggleFollow } = useOxyFollow(userId);
  // ... (API is the same)
}
```

## Troubleshooting

### Error: "Cannot read properties of undefined (reading 'auth')"

This usually means the Oxy reducers aren't included in your store:

```tsx
// ❌ Missing Oxy reducers
const store = configureStore({
  reducer: {
    myApp: myAppReducer,
  },
});

// ✅ Include Oxy reducers
const store = configureStore({
  reducer: {
    ...setupOxyStore(),
    myApp: myAppReducer,
  },
});
```

### Error: "useOxy must be used within OxyContextProvider"

Make sure you're using `OxyContextProvider`:

```tsx
// ❌ Missing context provider
<Provider store={store}>
  <YourApp />
</Provider>

// ✅ Include context provider
<Provider store={store}>
  <OxyContextProvider oxyServices={oxyServices}>
    <YourApp />
  </OxyContextProvider>
</Provider>
```

### TypeScript Errors

Update your type imports:

```tsx
// ❌ Old way
import type { RootState, AppDispatch } from '@oxyhq/services';

// ✅ New way - define your own types
const store = configureStore({
  reducer: {
    ...setupOxyStore(),
    // your reducers
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

## Testing Migration

Update your tests to use the new architecture:

```tsx
// test-utils.tsx
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { setupOxyStore } from '@oxyhq/services';

export function createTestStore() {
  return configureStore({
    reducer: {
      ...setupOxyStore(),
      // test-specific reducers
    },
  });
}

export function renderWithStore(component, store = createTestStore()) {
  return render(
    <Provider store={store}>
      {component}
    </Provider>
  );
}
```

## Rollback Plan

If you need to rollback temporarily:

```tsx
// Use the deprecated internal store
import { store, Provider } from '@oxyhq/services';

function App() {
  return (
    <Provider store={store}>
      <OxyContextProvider oxyServices={oxyServices}>
        <YourApp />
      </OxyContextProvider>
    </Provider>
  );
}
```

Note: This approach is deprecated and will be removed in future versions.

## Support

- Check the [Redux Integration Guide](./redux-integration.md) for detailed usage
- Review the [API Reference](./api-reference.md) for all available exports
- Open an issue on GitHub if you encounter migration problems