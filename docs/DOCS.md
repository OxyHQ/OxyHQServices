# OxyProvider Documentation

**Version: 5.1.33**

## Import Guide

Before using OxyProvider, make sure to import it from the correct path:

```javascript
// For UI components only
import { OxyProvider } from '@oxyhq/services/ui';

// For full package (core services + UI)
import { OxyProvider, OxyServices } from '@oxyhq/services/full';

// Core services only (no UI components)
import { OxyServices } from '@oxyhq/services';
```

## Overview

The OxyProvider is a versatile React Native component that provides authentication and user management functionality within the OxyHQ framework. It has two primary functions:

1. **Authentication UI**: An elegant bottom sheet interface with screens for sign-in, sign-up, and account management
2. **Authentication Context**: A centralized state management system for authentication across your app

## Installation

### Dependencies

The OxyProvider requires the following dependencies:

```bash
npm install react-native-gesture-handler react-native-reanimated react-native-safe-area-context @react-native-async-storage/async-storage
```

Note: The bottom sheet is now managed internally by the package, so you no longer need to install `@gorhom/bottom-sheet` separately.

### Setup

Ensure your app is wrapped with the GestureHandlerRootView:

```jsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Your app content including OxyProvider */}
    </GestureHandlerRootView>
  );
}
```

### Fonts

OxyProvider uses the Phudu font family for all headings and titles. The fonts are automatically loaded when using the OxyProvider component.

#### For React Native (with Expo)
No additional setup required. Fonts are loaded automatically.

#### For React Native (without Expo)
You'll need to ensure the fonts are properly linked in your native projects:

1. Copy the font files from `node_modules/@oxyhq/services/lib/commonjs/assets/fonts/Phudu/` to your project's font directory
2. Link the fonts using React Native's native linking:
   - For iOS: Add to Info.plist and include in the Xcode project
   - For Android: Place in `android/app/src/main/assets/fonts/`
3. Call `setupFonts()` from the package before rendering your app

#### For Web
The fonts are automatically loaded via CSS when using the OxyProvider component.

The Phudu font family includes multiple weights (Light, Regular, Medium, SemiBold, Bold, ExtraBold, and Black) for flexible typography.

For more detailed information, see [FONT_INTEGRATION.md](FONT_INTEGRATION.md)

## Usage

### Basic UI Usage

Use OxyProvider as a bottom sheet for authentication:

```jsx
import React, { useState } from 'react';
import { View, Button } from 'react-native';
import { OxyServices, OxyProvider } from '@oxyhq/services';

export default function App() {
  const [showAuth, setShowAuth] = useState(false);
  
  // Initialize OxyServices
  const oxyServices = new OxyServices({
    baseURL: 'https://api.example.com', // Replace with your API URL
  });
  
  const handleAuthenticated = (user) => {
    console.log('User authenticated:', user);
    setShowAuth(false);
  };
  
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Button 
        title="Sign In / Sign Up" 
        onPress={() => setShowAuth(true)} 
      />
      
      {showAuth && (
        <OxyProvider
          oxyServices={oxyServices}
          initialScreen="SignIn"
          onClose={() => setShowAuth(false)}
          onAuthenticated={handleAuthenticated}
          theme="light"
        />
      )}
    </View>
  );
}
```

### Context Provider Usage

Use OxyProvider as an authentication context provider:

```jsx
import React from 'react';
import { View, Text, Button } from 'react-native';
import { OxyServices, OxyProvider, useOxy } from '@oxyhq/services';

// Initialize OxyServices
const oxyServices = new OxyServices({
  baseURL: 'https://api.example.com',
});

// Main app component
function App() {
  return (
    <OxyProvider 
      oxyServices={oxyServices}
      contextOnly={true} // Use only as context provider, without the bottom sheet UI
    >
      <MainScreen />
    </OxyProvider>
  );
}

// Child component that uses authentication context
function MainScreen() {
  const { 
    user, 
    isAuthenticated, 
    isLoading, 
    login, 
    logout,
    signUp
  } = useOxy();

  // Handle authentication actions
  const handleLogin = async () => {
    try {
      await login('username', 'password');
      console.log('Login successful');
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  // Show loading state
  if (isLoading) {
    return <Text>Loading...</Text>;
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      {isAuthenticated ? (
        <>
          <Text>Welcome, {user.username}!</Text>
          <Button title="Sign Out" onPress={logout} />
        </>
      ) : (
        <>
          <Text>Please sign in</Text>
          <Button title="Sign In" onPress={handleLogin} />
        </>
      )}
    </View>
  );
}

export default App;
```

### Combined UI and Context Provider

Using both features together provides the most flexibility:

```jsx
import React, { useState } from 'react';
import { View, Text, Button } from 'react-native';
import { OxyServices, OxyProvider, useOxy } from '@oxyhq/services';

// Initialize OxyServices
const oxyServices = new OxyServices({
  baseURL: 'https://api.example.com',
});

// Main app component
function App() {
  const [showAuthSheet, setShowAuthSheet] = useState(false);
  
  return (
    <OxyProvider 
      oxyServices={oxyServices}
      contextOnly={!showAuthSheet} // Only show bottom sheet when requested
      onClose={() => setShowAuthSheet(false)}
      onAuthStateChange={(user) => {
        if (user) {
          // User has authenticated, hide the sheet
          setShowAuthSheet(false);
        }
      }}
    >
      <MainScreen onShowAuth={() => setShowAuthSheet(true)} />
    </OxyProvider>
  );
}

// Child component that uses authentication context
function MainScreen({ onShowAuth }) {
  const { user, isAuthenticated, isLoading, logout } = useOxy();

  // Show loading state
  if (isLoading) {
    return <Text>Loading...</Text>;
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      {isAuthenticated ? (
        <>
          <Text>Welcome, {user.username}!</Text>
          <Button title="View Account" onPress={onShowAuth} />
          <Button title="Sign Out" onPress={logout} />
        </>
      ) : (
        <>
          <Text>Please sign in</Text>
          <Button title="Sign In / Sign Up" onPress={onShowAuth} />
        </>
      )}
    </View>
  );
}

export default App;
```

## Authentication Context (useOxy)

The `useOxy()` hook provides access to the following properties and methods:

| Property | Type | Description |
|----------|------|-------------|
| `user` | `User \| null` | The current authenticated user or null |
| `isAuthenticated` | `boolean` | Whether the user is authenticated |
| `isLoading` | `boolean` | Whether authentication is being processed |
| `error` | `string \| null` | Any authentication error message |
| `login` | `(username: string, password: string) => Promise<User>` | Function to log in |
| `logout` | `() => Promise<void>` | Function to log out |
| `signUp` | `(username: string, email: string, password: string) => Promise<User>` | Function to sign up |
| `oxyServices` | `OxyServices` | The OxyServices instance |

## Storage Implementation

The OxyProvider includes a platform-aware storage system:

- **React Native**: Uses AsyncStorage for token and user data persistence
- **Web**: Uses localStorage with a compatible API 

This allows the same code to work across React Native and web platforms without any changes.

### Platform Detection

The system automatically detects whether it's running in React Native or web:

```typescript
const isReactNative = (): boolean => {
    return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
};
```

### Storage Interface

Both platforms implement the same interface:

```typescript
interface StorageInterface {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
    clear: () => Promise<void>;
}
```

### Token Storage

Tokens are stored with platform-specific key prefixes (configurable):

```
// Default keys
accessToken: "oxy_access_token"
refreshToken: "oxy_refresh_token"
user: "oxy_user"
```

### Multiple Token Formats Support

The system handles different API response formats:

1. Standard format: `{ accessToken, refreshToken, user }`
2. Legacy format: `{ token, user }`

The `storeTokens` utility function makes this transparent:

```typescript
const storeTokens = async (response: any) => {
  if (response.accessToken) {
    await storage?.setItem(keys.accessToken, response.accessToken);
    if (response.refreshToken) {
      await storage?.setItem(keys.refreshToken, response.refreshToken);
    }
  } else if (response.token) {
    // Handle legacy API response
    await storage?.setItem(keys.accessToken, response.token);
  }
  await storage?.setItem(keys.user, JSON.stringify(response.user));
};
```

## OxyProvider Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `oxyServices` | `OxyServices` | Yes | An initialized OxyServices instance |
| `initialScreen` | `string` | No | The initial screen to show. Options: "SignIn", "SignUp", "AccountCenter". Default: "SignIn" |
| `onClose` | `function` | No | Callback when the bottom sheet is closed |
| `onAuthenticated` | `function` | No | Callback when a user successfully authenticates |
| `theme` | `'light' \| 'dark'` | No | UI theme. Default: "light" |
| `customStyles` | `object` | No | Custom styles for the bottom sheet |
| `contextOnly` | `boolean` | No | When true, only provides the context without the bottom sheet UI. Default: false |
| `children` | `ReactNode` | No | Child components to render within the provider |
| `onAuthStateChange` | `function` | No | Callback when authentication state changes |
| `storageKeyPrefix` | `string` | No | Prefix for keys in storage. Default: "oxy" |

## Theming

OxyProvider supports both light and dark themes:

```jsx
<OxyProvider
  oxyServices={oxyServices}
  theme="dark" // or "light"
  customStyles={{
    backgroundColor: '#121212', // Custom background color
    handleColor: '#444444',     // Custom handle color
    contentPadding: 24,         // Custom padding for content
  }}
/>
```

## Screens

The OxyProvider includes three main screens:

1. **SignIn** - Login screen for existing users
2. **SignUp** - Registration screen for new users
3. **AccountCenter** - User profile and account management

## Internal Navigation

The component uses an internal router (`OxyRouter`) to navigate between authentication screens. You can set the initial screen via props, and the internal navigation handles user flow between screens.

### Navigation Architecture

The router manages:
- Screen transitions (SignIn → SignUp → AccountCenter)
- Navigation history (back navigation)
- Screen-specific snap points for the bottom sheet

```typescript
// Define route configuration with screen components and default snap points
const routes: Record<string, RouteConfig> = {
    SignIn: {
        component: SignInScreen,
        snapPoints: ['60%', '80%'],
    },
    SignUp: {
        component: SignUpScreen,
        snapPoints: ['70%', '90%'],
    },
    AccountCenter: {
        component: AccountCenterScreen,
        snapPoints: ['60%', '85%'],
    },
};
```

### Navigation Methods

Screen components receive navigation methods as props:

```typescript
// Navigate to another screen
navigate('SignUp', { referrer: 'signIn' }); // Optionally pass props

// Go back to previous screen
goBack();
```

### History Management

The router maintains a history stack to support back navigation:

```typescript
const [currentScreen, setCurrentScreen] = useState<string>(initialScreen);
const [screenHistory, setScreenHistory] = useState<string[]>([initialScreen]);

// When navigating to a new screen
setScreenHistory(prev => [...prev, screen]);

// When going back
if (screenHistory.length > 1) {
    const newHistory = [...screenHistory];
    newHistory.pop();
    const previousScreen = newHistory[newHistory.length - 1];
    setCurrentScreen(previousScreen);
    setScreenHistory(newHistory);
}
```

### Automatic Snap Point Adjustment

The router automatically adjusts the bottom sheet snap points based on the current screen:

```typescript
// Update snap points when the screen changes
useEffect(() => {
    if (routes[currentScreen]) {
        adjustSnapPoints(routes[currentScreen].snapPoints);
    }
}, [currentScreen, adjustSnapPoints]);
```

## Performance Considerations

### Rendering Optimization

The OxyProvider is designed to minimize re-renders, but you should still follow some best practices:

1. **Memoize Components**: Wrap components that use the `useOxy` hook with `React.memo` to prevent unnecessary re-renders:

```jsx
const UserInfo = React.memo(function UserInfo() {
  const { user } = useOxy();
  return <Text>Hello, {user?.username}</Text>;
});
```

2. **Selective Context Usage**: Only extract the specific context values you need:

```jsx
// Good - only re-renders when isAuthenticated changes
const { isAuthenticated } = useOxy();  

// Bad - re-renders when any auth state changes
const authContext = useOxy(); 
const isAuthenticated = authContext.isAuthenticated;
```

3. **Avoid Provider Nesting**: Don't wrap the OxyProvider with other context providers unnecessarily, as this can create additional render cycles.

### Memory Usage

For React Native apps, memory management is important:

1. **Cleanup on Unmount**: If you attach listeners in a component that uses OxyContext, make sure to clean them up:

```jsx
useEffect(() => {
  const subscription = someService.addListener();
  
  return () => {
    subscription.remove();
  };
}, []);
```

2. **Bottom Sheet Performance**: The bottom sheet uses native animations which are generally performant, but you should:
   - Avoid complex layouts within the sheet that change frequently
   - Use `useCallback` for event handlers
   - Consider using `react-native-reanimated` worklets for gesture handlers

### Network Considerations

Token refresh operations can impact performance:

1. **Preemptive Token Refresh**: For critical operations, you might want to manually check and refresh the token before proceeding:

```jsx
const performCriticalOperation = async () => {
  const { oxyServices } = useOxy();
  
  // Check if token will expire soon (within 5 minutes)
  const tokenInfo = oxyServices.getTokenInfo();
  const isExpiringSoon = tokenInfo.expiresAt - Date.now() < 5 * 60 * 1000;
  
  if (isExpiringSoon) {
    // Refresh token before proceeding
    await oxyServices.refreshToken();
  }
  
  // Now perform the operation
  await criticalApiCall();
};
```

2. **Offline Support**: Consider implementing offline detection:

```jsx
import NetInfo from '@react-native-community/netinfo';

function App() {
  const [isOffline, setIsOffline] = useState(false);
  
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOffline(!state.isConnected);
    });
    
    return () => unsubscribe();
  }, []);
  
  return (
    <OxyProvider oxyServices={oxyServices}>
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text>You are offline. Some features may be unavailable.</Text>
        </View>
      )}
      <YourApp />
    </OxyProvider>
  );
}
```

## API Reference

For detailed documentation about file management functionality, see [FILE_MANAGEMENT.md](./FILE_MANAGEMENT.md).

### Types

```typescript
// User interface
interface User {
  id: string;
  username: string;
  email?: string;
  // Other user properties
}

// Login response
interface LoginResponse {
  user: User;
  accessToken?: string;  // New format
  refreshToken?: string; // New format
  token?: string;        // Legacy format
}

// OxyContext state
interface OxyContextState {
  // Authentication state
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Auth methods
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  signUp: (username: string, email: string, password: string) => Promise<User>;

  // Access to services
  oxyServices: OxyServices;
}

// OxyProvider props
interface OxyProviderProps {
  oxyServices: OxyServices;
  initialScreen?: 'SignIn' | 'SignUp' | 'AccountCenter';
  onClose?: () => void;
  onAuthenticated?: (user: User) => void;
  theme?: 'light' | 'dark';
  customStyles?: {
    backgroundColor?: string;
    handleColor?: string;
    contentPadding?: number;
  };
  children?: ReactNode;
  contextOnly?: boolean;
  onAuthStateChange?: (user: User | null) => void;
  storageKeyPrefix?: string;
}

// Base screen props
interface BaseScreenProps {
  oxyServices: OxyServices;
  navigate: (screen: string, props?: any) => void;
  goBack: () => void;
  onClose?: () => void;
  onAuthenticated?: (user: User) => void;
  theme: 'light' | 'dark';
}
```

### Components

#### OxyProvider

Main component that provides authentication UI and context.

```typescript
function OxyProvider(props: OxyProviderProps): JSX.Element;
```

#### OxySignInButton

Pre-styled button component for signing in with Oxy services.

```typescript
function OxySignInButton(props: OxySignInButtonProps): JSX.Element | null;
```

For detailed documentation on OxySignInButton, see [UI_COMPONENTS.md](./UI_COMPONENTS.md).

#### OxyContextProvider

Context-only provider without UI.

```typescript
function OxyContextProvider(props: {
  children: ReactNode;
  oxyServices: OxyServices;
  storageKeyPrefix?: string;
  onAuthStateChange?: (user: User | null) => void;
}): JSX.Element;
```

#### useOxy Hook

```typescript
function useOxy(): OxyContextState;
```

#### SignInScreen

```typescript
function SignInScreen(props: BaseScreenProps): JSX.Element;
```

#### SignUpScreen

```typescript
function SignUpScreen(props: BaseScreenProps): JSX.Element;
```

#### AccountCenterScreen

```typescript
function AccountCenterScreen(props: BaseScreenProps): JSX.Element;
```

### Methods

#### login(username, password)

Authenticates a user with username and password.

```typescript
const { login } = useOxy();
const user = await login(username, password);
```

#### signUp(username, email, password)

Registers a new user.

```typescript
const { signUp } = useOxy();
const user = await signUp(username, email, password);
```

#### logout()

Logs out the current user.

```typescript
const { logout } = useOxy();
await logout();
```

## Advanced Usage

### Custom Initialization

You can perform custom initialization by using the `onAuthStateChange` callback:

```jsx
<OxyProvider
  oxyServices={oxyServices}
  onAuthStateChange={(user) => {
    if (user) {
      // Load user-specific data or settings
      loadUserSettings(user.id);
      
      // Set up user-specific API client configuration
      setupApiWithUserToken(user.id, oxyServices.getTokens().accessToken);
      
      // Track analytics
      analytics.identify(user.id, {
        username: user.username,
        email: user.email
      });
    } else {
      // Clear user-specific data
      clearUserSettings();
      resetApiClient();
      analytics.reset();
    }
  }}
>
  {/* Your app content */}
</OxyProvider>
```

### Individual Screen Components

If you prefer to build your own navigation, you can use the individual screen components:

```jsx
import { 
  SignInScreen, 
  SignUpScreen, 
  AccountCenterScreen,
  useOxy
} from '@oxyhq/services';

function CustomAuthFlow() {
  const [currentScreen, setCurrentScreen] = useState('SignIn');
  const { isAuthenticated } = useOxy();
  
  // Custom navigation logic
  const navigate = (screen) => {
    setCurrentScreen(screen);
  };
  
  // Render different screens based on state
  if (isAuthenticated) {
    return <AccountCenterScreen navigate={navigate} />;
  }
  
  if (currentScreen === 'SignIn') {
    return (
      <SignInScreen 
        navigate={navigate} 
        onNavigateToSignUp={() => navigate('SignUp')} 
      />
    );
  }
  
  if (currentScreen === 'SignUp') {
    return (
      <SignUpScreen 
        navigate={navigate} 
        onNavigateToSignIn={() => navigate('SignIn')} 
      />
    );
  }
}
```

### Custom Theme Implementation

For more advanced theming beyond light/dark:

```jsx
import { OxyProvider } from '@oxyhq/services/ui';

// Create a custom theme object
const myBrandTheme = {
  light: {
    backgroundColor: '#FFFFFF',
    textColor: '#333333',
    primaryColor: '#FF6B00', // Brand orange
    accentColor: '#0066CC',
    inputBackground: '#F5F5F5',
    borderColor: '#E0E0E0',
    errorColor: '#D32F2F',
  },
  dark: {
    backgroundColor: '#121212',
    textColor: '#FFFFFF',
    primaryColor: '#FF8F3F', // Lighter brand orange for dark mode
    accentColor: '#5499FF',
    inputBackground: '#2A2A2A',
    borderColor: '#444444',
    errorColor: '#FF6B6B',
  }
};

function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const currentTheme = isDarkMode ? myBrandTheme.dark : myBrandTheme.light;
  
  return (
    <OxyProvider
      oxyServices={oxyServices}
      theme={isDarkMode ? 'dark' : 'light'}
      customStyles={{
        backgroundColor: currentTheme.backgroundColor,
        handleColor: currentTheme.borderColor,
        contentPadding: 20,
      }}
      // Inject the theme object into all screens via props
      screenProps={{ customTheme: currentTheme }}
    >
      <View style={{ 
        flex: 1, 
        backgroundColor: currentTheme.backgroundColor
      }}>
        <Button 
          title="Toggle Theme" 
          onPress={() => setIsDarkMode(!isDarkMode)} 
        />
        {/* Rest of your app */}
      </View>
    </OxyProvider>
  );
}
```

### Programmatic Bottom Sheet Control

For more control over the bottom sheet:

```jsx
import React from 'react';
import { Button, View } from 'react-native';
import { OxyProvider, useOxy } from '@oxyhq/services';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Create a button component that uses the context methods
const BottomSheetControls = () => {
  const { showBottomSheet, hideBottomSheet } = useOxy();
  
  // Methods to control the sheet
  const openSheet = () => showBottomSheet('SignIn');
  const closeSheet = () => hideBottomSheet();
  const snapToIndex = (index) => bottomSheetRef.current?.snapToIndex(index);
  
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ margin: 20 }}>
        <Button title="Open Auth" onPress={openSheet} />
        <Button title="Close Auth" onPress={closeSheet} />
        <Button title="Half Open" onPress={() => snapToIndex(0)} />
        <Button title="Fully Open" onPress={() => snapToIndex(1)} />
      </View>
      
      <OxyProvider
        oxyServices={oxyServices}
        bottomSheetRef={bottomSheetRef}
        onClose={() => console.log('Sheet closed')}
      />
    </GestureHandlerRootView>
  );
}
```

> **Note for Native Platforms**: Ensure that your app is wrapped with `GestureHandlerRootView` for proper gesture handling on React Native, and that you're using the `bottomSheetRef` prop to control the sheet programmatically.

### Multi-Environment Configuration

For apps that need to work across different environments:

```jsx
import { OxyServices, OxyProvider } from '@oxyhq/services';

// Environment configuration
const ENV = {
  dev: {
    API_URL: 'https://dev-api.example.com',
    STORAGE_PREFIX: 'dev_oxy',
  },
  staging: {
    API_URL: 'https://staging-api.example.com',
    STORAGE_PREFIX: 'staging_oxy',
  },
  prod: {
    API_URL: 'https://api.example.com',
    STORAGE_PREFIX: 'oxy',
  }
};

// Select environment based on build config
const currentEnv = __DEV__ ? ENV.dev : ENV.prod;

// Initialize services with environment-specific config
const oxyServices = new OxyServices({
  baseURL: currentEnv.API_URL,
  // Other config options
});

function App() {
  return (
    <OxyProvider
      oxyServices={oxyServices}
      storageKeyPrefix={currentEnv.STORAGE_PREFIX}
    >
      {/* App content */}
    </OxyProvider>
  );
}
```

## Error Handling

The authentication context provides error handling via the `error` state:

```jsx
const { error, login } = useOxy();

// Display error to user
{error && <Text style={styles.errorText}>{error}</Text>}

// Attempt login
const handleLogin = async () => {
  try {
    await login(username, password);
  } catch (error) {
    // Additional error handling if needed
    console.error('Login error:', error);
  }
};
```

### Handling Different Error Types

You can implement more sophisticated error handling based on API response patterns:

```jsx
const handleLogin = async () => {
  try {
    await login(username, password);
    // Success, handle navigation or other actions
  } catch (error) {
    // Check for specific error types
    if (error.message.includes('credentials')) {
      setFormErrors({ password: 'Invalid username or password' });
    } else if (error.message.includes('network')) {
      Alert.alert(
        'Connection Error',
        'Please check your internet connection and try again'
      );
    } else if (error.status === 429) {
      Alert.alert(
        'Too Many Attempts',
        'You have made too many login attempts. Please try again later.'
      );
    } else {
      // Generic error handling
      setFormErrors({ 
        general: 'An unexpected error occurred. Please try again.' 
      });
    }
  }
};
```

### Error Boundary Pattern

For React applications, you can implement an error boundary around your auth components:

```jsx
import React from 'react';

class AuthErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to an error reporting service
    console.error('Auth error:', error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Authentication Error</Text>
          <Text style={styles.errorText}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </Text>
          <Button title="Try Again" onPress={this.resetError} />
        </View>
      );
    }

    return this.props.children;
  }
}

// Usage
function App() {
  return (
    <AuthErrorBoundary>
      <OxyProvider oxyServices={oxyServices}>
        {/* Your application */}
      </OxyProvider>
    </AuthErrorBoundary>
  );
}
```

### Handling Refresh Token Failures

OxyContext handles token refreshing internally, but you can listen for authentication failures:

```jsx
<OxyProvider
  oxyServices={oxyServices}
  onAuthStateChange={(user) => {
    if (!user && previouslyHadUser) {
      // User was logged out, possibly due to an invalid refresh token
      Alert.alert(
        'Session Expired',
        'Your session has expired. Please log in again.'
      );
      // Navigate to login
      navigation.navigate('Login');
    }
  }}
>
  {/* Your app content */}
</OxyProvider>
```

## Best Practices

1. **Initialize Early**: Initialize the OxyProvider near the top of your component tree to make authentication state available throughout your application.

2. **Error Handling**: Always wrap authentication calls in try/catch blocks and display user-friendly error messages.

3. **Loading States**: Use the isLoading flag to display appropriate loading indicators. Disable buttons during authentication operations to prevent duplicate requests.

4. **Secure Storage**: The provider handles token storage securely. Don't store auth tokens elsewhere in your application to avoid security risks.

5. **Theme Consistency**: Match the provider's theme with your app's theme for visual consistency across the entire application.

6. **Keep Navigation Simple**: Use the built-in navigation for authentication flows when possible. Only implement custom navigation when you have specific requirements.

7. **Platform-Specific Adjustments**: Use platform checks for features that should behave differently on web vs. native:

   ```jsx
   import { Platform } from 'react-native';
   
   // For React Native specific code
   if (Platform.OS !== 'web') {
     // React Native only code
   }
   
   // For web-specific code
   if (Platform.OS === 'web') {
     // Web only code
   }
   ```

8. **Token Management**: Let OxyContext handle token refresh automatically. Only manually manage tokens if you have special requirements.

9. **Performance Optimization**: For large applications, consider using React.memo or useMemo to optimize components that use the authentication context.

10. **Testing**: When testing components that use OxyContext, make sure to wrap them with OxyContextProvider in your tests:

    ```jsx
    // In your test file
    import { render } from '@testing-library/react-native';
    import { OxyContextProvider } from '@oxyhq/services';
    
    // Mock the OxyServices
    const mockOxyServices = {
      login: jest.fn(),
      logout: jest.fn(),
      // ...other methods
    };
    
    test('Component renders correctly when authenticated', () => {
      const wrapper = ({ children }) => (
        <OxyContextProvider 
          oxyServices={mockOxyServices}
          initialUser={{ id: '123', username: 'testuser' }}
        >
          {children}
        </OxyContextProvider>
      );
      
      render(<YourComponent />, { wrapper });
      // Test assertions...
    });
    ```

## Real-World Example: Integration with React Navigation

Here's a complete example of integrating OxyProvider with React Navigation:

```jsx
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { OxyServices, OxyProvider, useOxy } from '@oxyhq/services';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, View } from 'react-native';

// Initialize OxyServices
const oxyServices = new OxyServices({
  baseURL: 'https://api.example.com',
});

// Create navigation stacks
const AuthStack = createStackNavigator();
const MainStack = createStackNavigator();
const Tabs = createBottomTabNavigator();

// Auth stack screens
function AuthStackScreens() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Welcome" component={WelcomeScreen} />
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

// Main app tabs
function AppTabs() {
  return (
    <Tabs.Navigator>
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Profile" component={ProfileScreen} />
      <Tabs.Screen name="Settings" component={SettingsScreen} />
    </Tabs.Navigator>
  );
}

// Authentication state aware navigator
function AppNavigator() {
  const { isAuthenticated, isLoading } = useOxy();
  const [showAuth, setShowAuth] = useState(false);
  
  // Show a loading screen while checking auth state
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#0066CC" />
      </View>
    );
  }
  
  return (
    <NavigationContainer>
      {isAuthenticated ? (
        <MainStack.Navigator>
          <MainStack.Screen name="Main" component={AppTabs} />
          {/* Other authenticated screens */}
        </MainStack.Navigator>
      ) : (
        <AuthStack.Navigator>
          <AuthStack.Screen name="Auth" component={AuthStackScreens} />
        </AuthStack.Navigator>
      )}
      
      {/* OxyProvider UI mode for account management */}
      {showAuth && (
        <OxyProvider
          oxyServices={oxyServices}
          initialScreen={isAuthenticated ? "AccountCenter" : "SignIn"}
          onClose={() => setShowAuth(false)}
          contextOnly={false}
        />
      )}
    </NavigationContainer>
  );
}

// Main application component
export default function App() {
  return (
    <OxyProvider 
      oxyServices={oxyServices}
      contextOnly={true}
      onAuthStateChange={(user) => {
        // Handle auth state changes, like updating analytics
        if (user) {
          analytics.identify(user.id);
        } else {
          analytics.reset();
        }
      }}
    >
      <AppNavigator />
    </OxyProvider>
  );
}

// Screen components would be defined elsewhere
```

This example demonstrates:
- Using OxyProvider in context-only mode for the main app
- Conditionally rendering UI based on authentication state
- Displaying a loading indicator during authentication checks
- Using OxyProvider in UI mode for account management
- Navigation structure that adapts to authentication state
