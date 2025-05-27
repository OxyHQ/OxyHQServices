# OxyHQ Services UI Components

This document provides details about the UI components available in the `@oxyhq/services` package.

## Import Guide

The package provides different entry points for different use cases:

### For Node.js/Express (Server-side only)
```javascript
// Only core services and models - no UI components
import { OxyServices } from '@oxyhq/services';
```

### For React/React Native apps (UI components only)
```javascript
// UI components and context providers
import { OxyProvider, OxySignInButton, OxyLogo, Avatar } from '@oxyhq/services/ui';
```

### For full package (Core + UI)
```javascript
// Everything - core services, models, and UI components
import { OxyServices, OxyProvider, OxySignInButton } from '@oxyhq/services/full';
```

## Table of Contents

- [OxyProvider](#oxyprovider)
- [OxySignInButton](#oxysigninbutton)
- [OxyLogo](#oxylogo)
- [Avatar](#avatar)
- [FollowButton](#followbutton)
- [Multi-User Components](#multi-user-components)
  - [AccountSwitcherScreen](#accountswitcherscreen)
  - [SessionManagementScreen](#sessionmanagementscreen)
  - [Enhanced SignInScreen](#enhanced-signinscreen)
- [Screens](#screens)
  - [AccountCenterScreen](#accountcenterscreen)
  - [AppInfoScreen](#appinfoscreen)

## OxyProvider

The main provider component that manages authentication state and exposes the bottom sheet for sign-in, sign-up, and account management.

```tsx
import { OxyProvider } from '@oxyhq/services/ui';

// In your app
<OxyProvider
  oxyServices={oxyServicesInstance}
  initialScreen="SignIn"
  autoPresent={false}
  onAuthenticated={(user) => console.log('User authenticated:', user)}
  theme="light"
>
  {children}
</OxyProvider>
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| oxyServices | `OxyServices` | Yes | Instance of OxyServices initialized with your API configuration |
| initialScreen | `'SignIn' \| 'SignUp' \| 'AccountCenter'` | No | Initial screen to display when the sheet opens |
| autoPresent | `boolean` | No | Whether to automatically present the sheet on mount |
| onAuthenticated | `(user: User) => void` | No | Callback when a user is authenticated |
| onClose | `() => void` | No | Callback when the sheet is closed |
| onAuthStateChange | `(user: User \| null) => void` | No | Callback when auth state changes |
| storageKeyPrefix | `string` | No | Prefix for stored auth tokens |
| theme | `'light' \| 'dark'` | No | Theme for the sheet UI |

## OxySignInButton

A pre-styled button component for signing in with Oxy services. This component automatically integrates with the OxyProvider context and will control the authentication bottom sheet when pressed.

```tsx
import { OxySignInButton } from '@oxyhq/services';

// Basic usage
<OxySignInButton />

// Custom styling
<OxySignInButton 
  variant="contained" 
  style={{ marginTop: 20 }} 
  text="Login with Oxy" 
/>

// Custom handler
<OxySignInButton onPress={() => {
  // Custom authentication flow
  console.log('Custom auth flow initiated');
}} />
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'default' \| 'outline' \| 'contained'` | `'default'` | Controls the appearance of the button |
| onPress | `() => void` | `undefined` | Optional function to handle button press, if not provided, the button will use the `showBottomSheet` method from OxyContext |
| style | `StyleProp<ViewStyle>` | `undefined` | Additional styles for the button container |
| textStyle | `StyleProp<TextStyle>` | `undefined` | Additional styles for the button text |
| text | `string` | `'Sign in with Oxy'` | Custom button text |
| navigationDelay | `number` | `300` | Delay in milliseconds before navigating to SignIn screen after expanding |
| disabled | `boolean` | `false` | Whether to disable the button |
| showWhenAuthenticated | `boolean` | `false` | Whether to show the button even if user is already authenticated |

### Design Variants

- **Default**: A flat white button with a subtle shadow
- **Outline**: A transparent button with a colored border
- **Contained**: A solid colored button with white text

### Behavior

By default, the OxySignInButton:

1. Uses the context from OxyProvider to detect if a user is already authenticated
2. Only renders if no user is authenticated (unless showWhenAuthenticated is true)
3. When pressed, automatically opens the bottom sheet and navigates to the SignIn screen
4. Can be customized with your own onPress handler for custom authentication flows

## OxyLogo

The Oxy logo component for React Native applications. This is an SVG component that can be used to display the Oxy logo in your app.

```tsx
import { OxyLogo } from '@oxyhq/services';

// Basic usage
<OxyLogo />

// Custom size
<OxyLogo width={32} height={32} />

// With custom style
<OxyLogo 
  width={24} 
  height={24} 
  style={{ margin: 5 }} 
/>

// With custom colors
<OxyLogo 
  width={24} 
  height={24}
  fillColor="#9c27b0" 
  secondaryFillColor="#ce93d8"
/>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| width | `number` | `24` | Width of the logo in pixels |
| height | `number` | `24` | Height of the logo in pixels |
| style | `StyleProp<ViewStyle>` | `undefined` | Additional styles for the logo container |
| fillColor | `string` | `'#d169e5'` | Primary fill color for the logo |
| secondaryFillColor | `string` | `'#db85ec'` | Secondary fill color for the inner glow effect |

### Requirements

This component requires `react-native-svg` to be installed in your project:

```bash
npm install react-native-svg
# or
yarn add react-native-svg
```

## FollowButton

An animated button component for social interactions that toggles between "Follow" and "Following" states with smooth transitions.

```tsx
import { FollowButton } from '@oxyhq/services';

// Basic usage
<FollowButton userId="123" />

// With custom styling
<FollowButton 
  userId="123" 
  initiallyFollowing={true}
  size="large"
  style={{ borderRadius: 12 }}
  onFollowChange={(isFollowing) => console.log(`User is now ${isFollowing ? 'followed' : 'unfollowed'}`)}
/>

// Different sizes
<FollowButton userId="123" size="small" />
<FollowButton userId="123" size="medium" /> // default
<FollowButton userId="123" size="large" />

// Disabled state
<FollowButton userId="123" disabled={true} />
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| userId | `string` | *Required* | The ID of the user to follow/unfollow |
| initiallyFollowing | `boolean` | `false` | Initial follow state, if already known |
| size | `'small' \| 'medium' \| 'large'` | `'medium'` | Size variant of the button |
| onFollowChange | `(isFollowing: boolean) => void` | `undefined` | Callback function invoked when follow state changes |
| style | `StyleProp<ViewStyle>` | `undefined` | Additional styles for the button container |
| textStyle | `StyleProp<TextStyle>` | `undefined` | Additional styles for the button text |
| disabled | `boolean` | `false` | Whether the button is disabled |
| showLoadingState | `boolean` | `true` | Whether to show loading indicator during API calls |

### Requirements

This component requires `react-native-reanimated` to be installed in your project:

```bash
npm install react-native-reanimated
# or
yarn add react-native-reanimated
```

> **Note:** After installing react-native-reanimated, you may need to set up the Babel plugin. Add `'react-native-reanimated/plugin'` to your Babel plugins in `babel.config.js`.

## Multi-User Components

The Oxy Services library includes several components specifically designed for multi-user authentication and session management.

### AccountSwitcherScreen

A screen component that displays all authenticated user accounts and allows switching between them.

**Features:**
- Display all authenticated user accounts
- Switch between accounts with a single tap
- Remove accounts from the list
- Add new accounts
- Visual indication of the current active account

**Usage:**
```tsx
import { useOxy } from '@oxyhq/services/full';

function MyComponent() {
  const { showBottomSheet } = useOxy();
  
  const openAccountSwitcher = () => {
    showBottomSheet('AccountSwitcher');
  };
  
  return (
    <button onClick={openAccountSwitcher}>
      Switch Account
    </button>
  );
}
```

**Navigation Path:** Available via `showBottomSheet('AccountSwitcher')`

### SessionManagementScreen

A comprehensive session management interface that shows active sessions across all devices with logout capabilities.

**Features:**
- View all active sessions across devices
- Display device information (platform, browser, OS, IP address)
- Individual session logout
- Bulk logout operations
- Session activity timestamps
- Current session indication

**Usage:**
```tsx
import { useOxy } from '@oxyhq/services/full';

function MyComponent() {
  const { showBottomSheet } = useOxy();
  
  const openSessionManager = () => {
    showBottomSheet('SessionManagement');
  };
  
  return (
    <button onClick={openSessionManager}>
      Manage Sessions
    </button>
  );
}
```

**Navigation Path:** Available via `showBottomSheet('SessionManagement')`

### Enhanced SignInScreen

The sign-in screen has been enhanced to support multi-user functionality. When a user is already authenticated, it automatically switches to "Add Account" mode.

**Features:**
- Standard sign-in/sign-up functionality
- Automatic "Add Account" mode when user is authenticated
- Seamless integration with existing authentication flow
- Support for multiple account registration

**Usage:**
```tsx
import { useOxy } from '@oxyhq/services/full';

function MyComponent() {
  const { showBottomSheet, user } = useOxy();
  
  const openSignIn = () => {
    // Will show "Add Account" mode if user is already authenticated
    showBottomSheet('SignIn');
  };
  
  return (
    <button onClick={openSignIn}>
      {user ? 'Add Another Account' : 'Sign In'}
    </button>
  );
}
```

**Multi-User Context Integration:**
```tsx
// The enhanced context provides multi-user functionality
const {
  user,           // Current active user
  users,          // All authenticated users
  switchUser,     // Switch to different user
  removeUser,     // Remove user from account list
  getUserSessions, // Get user's active sessions
  logoutSession,  // Logout from specific session
  logoutAll       // Logout from all accounts
} = useOxy();
```

## Screens

### AccountCenterScreen

The AccountCenterScreen component serves as a central hub for users to access and manage their account settings, preferences, and information.

```tsx
import { AccountCenterScreen } from '@oxyhq/services';

// Basic usage
<AccountCenterScreen
  user={currentUser}
  onEditProfile={() => console.log('Edit profile')}
  onChangePassword={() => console.log('Change password')}
/>
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| user | `User` | *Required* | The current user object |
| onEditProfile | `() => void` | `undefined` | Callback function invoked when editing the profile |
| onChangePassword | `() => void` | `undefined` | Callback function invoked when changing the password |

### AppInfoScreen

The AppInfoScreen component provides comprehensive information about the application, including package details, system information, user data, and diagnostic tools. This screen is useful for debugging, support, and transparency purposes.

```tsx
import { AppInfoScreen } from '@oxyhq/services/ui';

// Basic usage in OxyRouter
<AppInfoScreen
  theme="light"
  onClose={() => console.log('Closing app info')}
  navigate={(route) => console.log(`Navigating to ${route}`)}
/>
```

#### Features

- **Package Information**: Displays current version, name, description, and module entry points
- **System Information**: Shows platform details, screen dimensions, and environment data
- **User Information**: Current authentication status, user details, and multi-user data
- **API Configuration**: Base URL and connection status
- **Build Information**: Timestamp, environment, and JavaScript engine details
- **Dependencies**: Framework versions and enabled features
- **Interactive Elements**: Copy-to-clipboard functionality and system check tools

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| theme | `'light' \| 'dark'` | `'light'` | Theme mode for styling |
| onClose | `() => void` | `undefined` | Callback when user closes the screen |
| navigate | `(route: string, params?: any) => void` | `undefined` | Navigation function for routing |

#### Information Sections

1. **Package Information**
   - Package name and version (dynamically loaded from package.json)
   - Description and main entry points
   - Module and TypeScript definitions

2. **System Information**
   - Platform (iOS, Android, Web)
   - Platform version
   - Screen dimensions
   - Development/Production environment

3. **User Information**
   - Authentication status
   - Current user details (ID, username, email, premium status)
   - Multi-user account count

4. **API Configuration**
   - Base API URL
   - Connection status

5. **Build Information**
   - Build timestamp
   - React Native framework
   - JavaScript engine (Hermes)

6. **Actions**
   - Copy full report to clipboard (JSON format)
   - Run system check
   - Individual field copy functionality

#### Usage in AccountCenter

The AppInfoScreen is accessible from the AccountCenterScreen via the "App Information" button, providing users with transparency about the application and useful debugging information.

#### Copy Functionality

Users can copy individual fields by tapping on values marked as copyable, or generate a complete JSON report with all application information for support purposes.
