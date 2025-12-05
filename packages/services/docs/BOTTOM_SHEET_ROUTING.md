# Bottom Sheet Routing System

A comprehensive routing system for displaying screens within a bottom sheet modal, with full navigation history support and step-based screen navigation.

## Overview

The bottom sheet routing system provides a clean, professional way to display authentication screens, account management screens, and other UI flows within a modal bottom sheet. It includes:

- **Reusable Bottom Sheet Component**: Built with `@gorhom/bottom-sheet` v5+
- **Navigation History**: Full back navigation support with history stack
- **Step-Based Navigation**: Support for multi-step screens (e.g., sign-in flows)
- **Keyboard Awareness**: Automatic padding adjustment when keyboard appears
- **Dynamic Sizing**: Bottom sheet automatically sizes to content
- **Type-Safe**: Full TypeScript support with proper types

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Usage Examples](#usage-examples)
- [Navigation History](#navigation-history)
- [Step-Based Screens](#step-based-screens)
- [Keyboard Handling](#keyboard-handling)
- [Advanced Topics](#advanced-topics)

## Quick Start

### Basic Usage

```typescript
import { useOxy } from '@oxyhq/services';

function MyComponent() {
  const { showBottomSheet } = useOxy();

  const handleSignIn = () => {
    showBottomSheet('SignIn');
  };

  return (
    <Button onPress={handleSignIn} title="Sign In" />
  );
}
```

### Opening a Screen with Props

```typescript
const { showBottomSheet } = useOxy();

// Open sign-in screen with pre-filled username
showBottomSheet({
  screen: 'SignIn',
  props: {
    username: 'user@example.com',
    initialStep: 1, // Start at step 1 (password step)
  },
});
```

### Closing the Bottom Sheet

```typescript
const { showBottomSheet, closeBottomSheet } = useOxy();

// Close programmatically
closeBottomSheet();
```

## Architecture

### Component Hierarchy

```
OxyProvider
  └── BottomSheetModalProvider (from @gorhom/bottom-sheet)
      └── BottomSheetRouter
          └── BottomSheet (reusable component)
              └── Screen Component (dynamically loaded)
```

### Key Components

1. **BottomSheet** (`packages/services/src/ui/components/BottomSheet.tsx`)
   - Reusable bottom sheet component using `@gorhom/bottom-sheet` v5
   - Handles keyboard avoidance and dynamic sizing
   - Provides imperative API via ref

2. **BottomSheetRouter** (`packages/services/src/ui/components/BottomSheetRouter.tsx`)
   - Manages navigation state and history
   - Renders appropriate screen based on current route
   - Handles step navigation and back navigation

3. **Screen Registry** (`packages/services/src/ui/navigation/routes.ts`)
   - Lazy-loaded screen registry
   - Maps route names to screen components
   - Prevents require cycles

4. **State Management** (`packages/services/src/ui/navigation/bottomSheetManager.ts`)
   - Pure state management (no React dependencies)
   - Manages navigation history stack
   - Tracks current screen, props, and step

## API Reference

### `showBottomSheet()`

Opens a bottom sheet with the specified screen.

**Signature:**
```typescript
showBottomSheet(
  screenOrConfig: RouteName | { 
    screen: RouteName; 
    props?: Record<string, unknown> 
  }
): void
```

**Parameters:**
- `screenOrConfig`: Either a route name string or a configuration object
  - `screen`: The route name to navigate to
  - `props`: Optional props to pass to the screen

**Example:**
```typescript
// Simple usage
showBottomSheet('SignIn');

// With props
showBottomSheet({
  screen: 'SignIn',
  props: {
    username: 'user@example.com',
    initialStep: 1,
  },
});
```

### `closeBottomSheet()`

Closes the currently open bottom sheet.

**Signature:**
```typescript
closeBottomSheet(): void
```

**Example:**
```typescript
const { closeBottomSheet } = useOxy();
closeBottomSheet();
```

### Available Routes

The following routes are available:

- `SignIn` - Sign in screen with multi-step flow
- `SignUp` - Sign up screen with multi-step flow
- `AccountOverview` - Account overview screen
- `AccountSettings` - Account settings screen
- `AccountCenter` - Account center screen
- `AccountSwitcher` - Switch between accounts
- `AccountVerification` - Account verification screen
- `SessionManagement` - Manage active sessions
- `PaymentGateway` - Payment gateway screen
- `Profile` - User profile screen
- `LanguageSelector` - Language selection screen
- `PrivacySettings` - Privacy settings screen
- `SearchSettings` - Search settings screen
- `FileManagement` - File management screen
- `HelpSupport` - Help and support screen
- `Feedback` - Feedback screen
- `LegalDocuments` - Legal documents viewer
- `AppInfo` - App information screen
- `PremiumSubscription` - Premium subscription screen
- `RecoverAccount` - Account recovery screen
- `WelcomeNewUser` - Welcome screen for new users
- `UserLinks` - User links management
- `HistoryView` - History view screen
- `SavesCollections` - Saved collections screen
- `EditProfile` - Edit profile screen (alias for AccountSettings)

## Usage Examples

### Example 1: Simple Sign-In Flow

```typescript
import { useOxy } from '@oxyhq/services';

function LoginButton() {
  const { showBottomSheet, isAuthenticated } = useOxy();

  if (isAuthenticated) {
    return <Text>Already signed in</Text>;
  }

  return (
    <Button
      onPress={() => showBottomSheet('SignIn')}
      title="Sign In"
    />
  );
}
```

### Example 2: Navigation Between Screens

```typescript
function AccountScreen() {
  const { showBottomSheet } = useOxy();

  return (
    <View>
      <Button
        onPress={() => showBottomSheet('AccountSettings')}
        title="Settings"
      />
      <Button
        onPress={() => showBottomSheet('Profile')}
        title="Profile"
      />
      <Button
        onPress={() => showBottomSheet('SessionManagement')}
        title="Sessions"
      />
    </View>
  );
}
```

### Example 3: Pre-filling Form Data

```typescript
function PrefillSignIn() {
  const { showBottomSheet } = useOxy();

  const handleSignInWithEmail = (email: string) => {
    showBottomSheet({
      screen: 'SignIn',
      props: {
        username: email,
        initialStep: 1, // Skip to password step
      },
    });
  };

  return (
    <Button
      onPress={() => handleSignInWithEmail('user@example.com')}
      title="Sign In with Email"
    />
  );
}
```

### Example 4: Handling Authentication Callbacks

```typescript
function CustomSignInScreen() {
  const { showBottomSheet } = useOxy();

  const handleSignIn = () => {
    showBottomSheet({
      screen: 'SignIn',
      props: {
        onAuthenticated: (user) => {
          console.log('User signed in:', user);
          // Handle successful authentication
        },
      },
    });
  };

  return <Button onPress={handleSignIn} title="Sign In" />;
}
```

## Navigation History

The bottom sheet router maintains a navigation history stack, allowing users to navigate back through previously visited screens.

### How It Works

1. **Forward Navigation**: When navigating to a new screen, the current screen is added to history
2. **Back Navigation**: `goBack()` pops from history and navigates to the previous screen
3. **Step Navigation**: Navigating between steps within the same screen doesn't add to history
4. **History Priority**: Screen history takes precedence over step navigation

### Navigation Flow

```
Screen A → Screen B → Screen C
History: [A, B]

goBack() from C → Navigate to B
History: [A]

goBack() from B → Navigate to A
History: []

goBack() from A → Close sheet (no history)
```

### Using goBack() in Screens

Screens receive a `goBack()` function as a prop:

```typescript
import type { BaseScreenProps } from '@oxyhq/services';

const MyScreen: React.FC<BaseScreenProps> = ({ goBack }) => {
  return (
    <View>
      <Button onPress={goBack} title="Back" />
    </View>
  );
};
```

### Step Navigation vs Screen Navigation

- **Step Navigation**: Moving between steps within the same screen (e.g., SignIn step 0 → step 1)
  - Does NOT add to history
  - Uses `navigate(sameScreen, { initialStep: newStep })`
  
- **Screen Navigation**: Moving to a different screen (e.g., SignIn → AccountSettings)
  - Adds current screen to history
  - Uses `navigate(differentScreen, props)`

## Step-Based Screens

Some screens use a multi-step flow (e.g., SignIn, SignUp, RecoverAccount). The router handles step navigation automatically.

### Step Navigation Behavior

1. **Forward Steps**: Navigate to next step within the same screen
2. **Back Steps**: `goBack()` navigates to previous step if not on step 0
3. **Step 0 Back**: If on step 0, `goBack()` checks screen history first

### Example: Sign-In Flow

```typescript
// SignIn screen has 3 steps:
// Step 0: Username
// Step 1: Password
// Step 2: MFA (if required)

// User flow:
// 1. Open SignIn → Step 0 (username)
// 2. Enter username, proceed → Step 1 (password)
// 3. goBack() → Step 0 (username)
// 4. Enter password, proceed → Step 2 (MFA)
// 5. goBack() → Step 1 (password)
```

### Creating Step-Based Screens

Step-based screens use the `StepBasedScreen` component:

```typescript
import StepBasedScreen, { type StepConfig } from '../components/StepBasedScreen';

const MyStepScreen: React.FC<BaseScreenProps> = ({ initialStep = 0 }) => {
  const steps: StepConfig[] = [
    { id: 'step1', component: Step1Component },
    { id: 'step2', component: Step2Component },
    { id: 'step3', component: Step3Component },
  ];

  return (
    <StepBasedScreen
      steps={steps}
      initialStep={initialStep}
      // ... other props
    />
  );
};
```

## Keyboard Handling

The bottom sheet automatically adjusts its content padding when the keyboard appears, ensuring content is never obscured while maintaining scrollability.

### How It Works

1. **Keyboard Detection**: Listens to keyboard show/hide events
2. **Dynamic Padding**: Injects keyboard height + safe area insets into scroll view's bottom padding
3. **Scroll Support**: Uses `BottomSheetScrollView` for proper scrolling behavior
4. **Platform Support**: Works on both iOS and Android

### Implementation

The `BottomSheet` component:
- Tracks keyboard height via keyboard event listeners
- Calculates total bottom padding (safe area insets + keyboard height)
- Injects padding into child scroll view's `contentContainerStyle`

This ensures:
- Content remains scrollable at all times
- Bottom padding adjusts dynamically when keyboard opens/closes
- No overlap between content and keyboard

### Configuration

The bottom sheet uses these keyboard-related props:

```typescript
<BottomSheet
  keyboardBehavior="interactive"        // iOS: keyboard moves sheet
  keyboardBlurBehavior="restore"        // Restore position when keyboard hides
  android_keyboardInputMode="adjustResize" // Android: resize when keyboard shows
/>
```

### Customization

You can customize keyboard behavior by modifying the `BottomSheet` component props in `BottomSheetRouter.tsx`.

## Advanced Topics

### Custom Screen Props

Screens receive all `OxyContext` values as props (dependency injection pattern):

```typescript
const MyScreen: React.FC<BaseScreenProps> = ({
  user,
  isAuthenticated,
  login,
  logout,
  // ... all OxyContext values
}) => {
  // Use props directly, no need to call useOxy()
};
```

### Lazy Loading

Screens are lazy-loaded to prevent require cycles:

- Screens are only loaded when needed
- Components are cached after first load
- No performance impact on initial app load

### State Management

The router uses a pure state management approach:

- `bottomSheetManager.ts`: Pure state management (no React)
- `bottomSheetApi.ts`: Public API layer
- `BottomSheetRouter.tsx`: React component that subscribes to state

This architecture prevents require cycles and keeps the codebase clean.

### Adding New Screens

To add a new screen:

1. **Create the screen component** in `packages/services/src/ui/screens/`
2. **Add route name** to `RouteName` type in `routes.ts`
3. **Add lazy loader** to `screenLoaders` object in `routes.ts`

Example:

```typescript
// In routes.ts
export type RouteName = 
  | 'SignIn'
  | 'MyNewScreen'; // Add here

const screenLoaders: Record<RouteName, () => ComponentType<BaseScreenProps>> = {
  SignIn: () => require('../screens/SignInScreen').default,
  MyNewScreen: () => require('../screens/MyNewScreen').default, // Add here
};
```

### Type Safety

All navigation is fully type-safe:

```typescript
// RouteName is a union type
type RouteName = 'SignIn' | 'SignUp' | ...;

// TypeScript will error on invalid routes
showBottomSheet('InvalidRoute'); // ❌ Type error

// Props are typed
showBottomSheet({
  screen: 'SignIn',
  props: {
    username: 'user@example.com', // ✅ Typed
    invalidProp: 123, // ⚠️ May not be recognized by screen
  },
});
```

## Troubleshooting

### Bottom Sheet Doesn't Open

- Ensure `OxyProvider` wraps your app
- Check that `BottomSheetModalProvider` is included (automatically added by `OxyProvider`)
- Verify the route name is valid

### Navigation History Not Working

- Ensure you're navigating to different screens (not just changing steps)
- Check that `goBack()` is being called, not `closeBottomSheet()`
- Verify history is being populated (check `state.navigationHistory.length`)

### Keyboard Covers Content

- Ensure `keyboardBehavior` and `keyboardBlurBehavior` are set correctly
- Check that `enableDynamicSizing` is enabled
- Verify safe area insets are being applied

### Step Navigation Issues

- Ensure `initialStep` prop is being passed correctly
- Check that `StepBasedScreen` is being used for multi-step screens
- Verify `onStepChange` callback is working

## Related Documentation

- [API Reference](./API_REFERENCE.md) - Complete API documentation
- [Integration Guide](./INTEGRATION_GUIDE.md) - Platform-specific guides
- [Examples](./EXAMPLES.md) - More code examples
- [Best Practices](./BEST_PRACTICES.md) - Production patterns

