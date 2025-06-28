import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { setupOxyStore, OxyProvider } from '@oxyhq/services';

// Example 1: External store management
const appStore = configureStore({
  reducer: {
    ...setupOxyStore(),
    appFeatures: (state = { count: 0 }, action: any) => {
      switch (action.type) {
        case 'INCREMENT':
          return { ...state, count: state.count + 1 };
        default:
          return state;
      }
    },
  },
});

const oxyServices = new (require('@oxyhq/services').OxyServices)({
  apiUrl: 'https://api.oxy.so',
});

// Method 1: Pass external store to OxyProvider
function ExternalStoreApp() {
  return (
    <OxyProvider 
      oxyServices={oxyServices}
      store={appStore}
      contextOnly={true}
    >
      <AppContent />
    </OxyProvider>
  );
}

// Method 2: Manage Redux Provider externally
function ExternalProviderApp() {
  return (
    <Provider store={appStore}>
      <OxyProvider 
        oxyServices={oxyServices}
        skipReduxProvider={true}
        contextOnly={true}
      >
        <AppContent />
      </OxyProvider>
    </Provider>
  );
}

// Method 3: Full UI integration with external store
function FullUIWithExternalStore() {
  return (
    <Provider store={appStore}>
      <OxyProvider 
        oxyServices={oxyServices}
        skipReduxProvider={true}
        initialScreen="SignIn"
        theme="light"
      >
        <AppContent />
      </OxyProvider>
    </Provider>
  );
}

function AppContent() {
  const { useSelector, useDispatch } = require('react-redux');
  const { authSelectors, useOxyFollow } = require('@oxyhq/services');
  
  const user = useSelector(authSelectors.selectUser);
  const count = useSelector((state: any) => state.appFeatures.count);
  const dispatch = useDispatch();
  
  const { isFollowing, toggleFollow } = useOxyFollow('testUser');

  return (
    <div>
      <h1>External Store Integration</h1>
      
      {/* App state */}
      <section>
        <h2>App State</h2>
        <p>Count: {count}</p>
        <button onClick={() => dispatch({ type: 'INCREMENT' })}>
          Increment
        </button>
      </section>

      {/* Oxy auth state */}
      <section>
        <h2>Auth State (Oxy)</h2>
        {user ? (
          <p>Logged in as: {user.name}</p>
        ) : (
          <p>Not logged in</p>
        )}
      </section>

      {/* Oxy follow functionality */}
      <section>
        <h2>Follow Feature (Oxy)</h2>
        <button onClick={toggleFollow}>
          {isFollowing ? 'Unfollow' : 'Follow'} Test User
        </button>
      </section>
    </div>
  );
}

export { ExternalStoreApp, ExternalProviderApp, FullUIWithExternalStore };