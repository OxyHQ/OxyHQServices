import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { setupOxyStore, OxyContextProvider } from '@oxyhq/services';

// Your existing app reducers
const userSettingsReducer = (state = { theme: 'light', language: 'en' }, action: any) => {
  switch (action.type) {
    case 'SET_THEME':
      return { ...state, theme: action.payload };
    case 'SET_LANGUAGE':
      return { ...state, language: action.payload };
    default:
      return state;
  }
};

const navigationReducer = (state = { currentRoute: 'home' }, action: any) => {
  switch (action.type) {
    case 'NAVIGATE':
      return { ...state, currentRoute: action.payload };
    default:
      return state;
  }
};

const appDataReducer = (state = { items: [] }, action: any) => {
  switch (action.type) {
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, action.payload] };
    default:
      return state;
  }
};

// Create store that combines your existing reducers with Oxy reducers
const store = configureStore({
  reducer: {
    // Add Oxy reducers
    ...setupOxyStore(),
    
    // Your existing app reducers
    userSettings: userSettingsReducer,
    navigation: navigationReducer,
    appData: appDataReducer,
  },
  
  // Your existing middleware and enhancers can stay
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST'],
      },
    }),
});

// Type definitions for your enhanced store
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Your app component
function ExistingApp() {
  return (
    <Provider store={store}>
      <OxyContextProvider oxyServices={oxyServices}>
        <AppContent />
      </OxyContextProvider>
    </Provider>
  );
}

function AppContent() {
  return (
    <div>
      <Header />
      <MainContent />
      <Footer />
    </div>
  );
}

// Components can now use both Oxy state and your app state
function Header() {
  const { useSelector, useDispatch } = require('react-redux');
  const { authSelectors } = require('@oxyhq/services');
  
  const user = useSelector(authSelectors.selectUser);
  const theme = useSelector((state: RootState) => state.userSettings.theme);
  const dispatch = useDispatch();

  const toggleTheme = () => {
    dispatch({ 
      type: 'SET_THEME', 
      payload: theme === 'light' ? 'dark' : 'light' 
    });
  };

  return (
    <header style={{ backgroundColor: theme === 'dark' ? '#333' : '#fff' }}>
      <h1>My App</h1>
      {user && <p>Welcome, {user.name}!</p>}
      <button onClick={toggleTheme}>
        Switch to {theme === 'light' ? 'dark' : 'light'} theme
      </button>
    </header>
  );
}

function MainContent() {
  const { useSelector } = require('react-redux');
  const currentRoute = useSelector((state: RootState) => state.navigation.currentRoute);

  return (
    <main>
      <p>Current route: {currentRoute}</p>
      <SocialFeatures />
      <AppFeatures />
    </main>
  );
}

// Use Oxy features alongside your app features
function SocialFeatures() {
  const { useOxyFollow } = require('@oxyhq/services');
  
  const userIds = ['user1', 'user2', 'user3'];
  const { followData, toggleFollowForUser } = useOxyFollow(userIds);

  return (
    <section>
      <h2>Social Features (Oxy)</h2>
      {userIds.map(userId => (
        <div key={userId}>
          <span>User {userId}</span>
          <button 
            onClick={() => toggleFollowForUser(userId)}
            disabled={followData[userId]?.isLoading}
          >
            {followData[userId]?.isLoading ? 'Loading...' : 
             followData[userId]?.isFollowing ? 'Unfollow' : 'Follow'}
          </button>
        </div>
      ))}
    </section>
  );
}

function AppFeatures() {
  const { useSelector, useDispatch } = require('react-redux');
  const items = useSelector((state: RootState) => state.appData.items);
  const dispatch = useDispatch();

  const addItem = () => {
    dispatch({ 
      type: 'ADD_ITEM', 
      payload: `Item ${items.length + 1}` 
    });
  };

  return (
    <section>
      <h2>App Features</h2>
      <button onClick={addItem}>Add Item</button>
      <ul>
        {items.map((item: string, index: number) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function Footer() {
  const { useSelector } = require('react-redux');
  const language = useSelector((state: RootState) => state.userSettings.language);
  
  return (
    <footer>
      <p>Language: {language}</p>
    </footer>
  );
}

const oxyServices = new (require('@oxyhq/services').OxyServices)({
  apiUrl: 'https://api.oxy.so',
});

export default ExistingApp;