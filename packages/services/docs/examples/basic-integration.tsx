import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { setupOxyStore, OxyContextProvider } from '@oxyhq/services';
import { OxyServices } from '@oxyhq/services';

// Create your app's store with Oxy reducers
const store = configureStore({
  reducer: {
    ...setupOxyStore(),
    // Add your app-specific reducers here
  },
});

// Initialize OxyServices
const oxyServices = new OxyServices({
  apiUrl: 'https://api.oxy.so',
  // ... other config
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

function YourApp() {
  // Your app components here
  return (
    <div>
      <h1>My App</h1>
      <AuthStatus />
      <FollowExample />
    </div>
  );
}

// Example component using auth state
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

// Example component using follow functionality
function FollowExample() {
  const { useOxyFollow } = require('@oxyhq/services');
  
  const { isFollowing, isLoading, toggleFollow } = useOxyFollow('user123');

  return (
    <button 
      onClick={toggleFollow}
      disabled={isLoading}
    >
      {isLoading ? 'Loading...' : isFollowing ? 'Unfollow' : 'Follow'}
    </button>
  );
}

export default App;