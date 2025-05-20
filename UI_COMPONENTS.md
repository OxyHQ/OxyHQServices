# OxyHQ Services UI Components

This document provides details about the UI components available in the `@oxyhq/services` package.

## Table of Contents

- [OxyProvider](#oxyprovider)
- [OxySignInButton](#oxysigninbutton)
- [OxyLogo](#oxylogo)
- [Avatar](#avatar)
- [Screens](#screens)
  - [AccountSettingsScreen](#accountsettingsscreen)

## OxyProvider

The main provider component that manages authentication state and exposes the bottom sheet for sign-in, sign-up, and account management.

```tsx
import { OxyProvider } from '@oxyhq/services';

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

## Screens

### AccountSettingsScreen

The AccountSettingsScreen component provides a user interface for editing account settings and profile information.

```tsx
import { AccountSettingsScreen } from '@oxyhq/services';

// Basic usage
<AccountSettingsScreen
  goBack={() => {}}
  theme="light"
/>

// Start with a specific tab open
<AccountSettingsScreen
  goBack={() => {}}
  theme="dark"
  activeTab="password"
/>
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| activeTab | `'profile' \| 'password' \| 'notifications'` | `'profile'` | Initial active tab |
| theme | `'light' \| 'dark'` | `'light'` | Theme to use for styling |
| goBack | `() => void` | | Function to call when the back button is pressed |

#### Features

The screen is divided into three tabs:

1. **Profile**: Update username, email, bio, and avatar
2. **Password**: Change account password with validation
3. **Notifications**: Configure notification preferences

For more details, see [the documentation](./docs/screens/AccountSettings.md).
