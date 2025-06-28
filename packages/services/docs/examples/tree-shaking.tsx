import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { setupOxyStore, OxyContextProvider } from '@oxyhq/services';
import { OxyServices } from '@oxyhq/services';

// Example 1: Only include authentication
const authOnlyStore = configureStore({
  reducer: {
    ...setupOxyStore.pick('auth'),
    myAppFeature: myAppReducer,
  },
});

// Example 2: Include both auth and follow
const authAndFollowStore = configureStore({
  reducer: {
    ...setupOxyStore.pick('auth', 'follow'),
    myAppFeature: myAppReducer,
  },
});

// Example 3: Individual reducer imports for maximum control
import { authReducer, followReducer } from '@oxyhq/services';

const customStore = configureStore({
  reducer: {
    // Custom key names
    oxyAuth: authReducer,
    socialFeatures: followReducer,
    
    // Your app reducers
    myAppFeature: myAppReducer,
  },
});

// Your app reducer
function myAppReducer(state = { theme: 'light' }, action: any) {
  switch (action.type) {
    case 'SET_THEME':
      return { ...state, theme: action.payload };
    default:
      return state;
  }
}

const oxyServices = new OxyServices({
  apiUrl: 'https://api.oxy.so',
});

// Example using auth-only store
function AuthOnlyApp() {
  return (
    <Provider store={authOnlyStore}>
      <OxyContextProvider oxyServices={oxyServices}>
        <div>
          <h1>Auth-Only App</h1>
          <AuthStatus />
          {/* Follow features won't work since follow reducer isn't included */}
        </div>
      </OxyContextProvider>
    </Provider>
  );
}

// Example using custom store with renamed keys
function CustomKeyApp() {
  return (
    <Provider store={customStore}>
      <OxyContextProvider oxyServices={oxyServices}>
        <div>
          <h1>Custom Store App</h1>
          <CustomAuthStatus />
        </div>
      </OxyContextProvider>
    </Provider>
  );
}

// Component that works with custom store keys
function CustomAuthStatus() {
  const { useSelector } = require('react-redux');
  
  // Note: selectors work with standard key names
  // If using custom keys, you'd need custom selectors
  const user = useSelector((state: any) => state.oxyAuth.user);
  const isAuthenticated = useSelector((state: any) => state.oxyAuth.isAuthenticated);

  return (
    <div>
      {isAuthenticated ? (
        <p>Welcome, {user?.name}!</p>
      ) : (
        <p>Please sign in</p>
      )}
    </div>
  );
}

function AuthStatus() {
  const { useSelector } = require('react-redux');
  const { authSelectors } = require('@oxyhq/services');
  
  const user = useSelector(authSelectors.selectUser);
  const isAuthenticated = useSelector(authSelectors.selectIsAuthenticated);

  return (
    <div>
      {isAuthenticated ? (
        <p>Welcome, {user?.name}!</p>
      ) : (
        <p>Please sign in</p>
      )}
    </div>
  );
}

export { AuthOnlyApp, CustomKeyApp };