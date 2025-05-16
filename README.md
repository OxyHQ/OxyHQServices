# @oxyhq/services

Reusable OxyHQ module to handle authentication, user management, karma system and more 🚀

## Installation

```bash
npm install @oxyhq/services
```

## Dependencies

The package requires the following peer dependencies:

```bash
npm install @gorhom/bottom-sheet@^5 react-native-gesture-handler react-native-reanimated @react-native-async-storage/async-storage
```

## Quick Start

```tsx
import React, { useRef } from 'react';
import { View, Button } from 'react-native';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { OxyServices, OxyProvider, useOxy, OxySignInButton } from '@oxyhq/services';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function App() {
  // Create a ref for the bottom sheet
  const bottomSheetRef = useRef<BottomSheetModal>(null);

  // Initialize OxyServices
  const oxyServices = new OxyServices({
    baseURL: 'https://api.example.com', // Replace with your API URL
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <OxyProvider
        oxyServices={oxyServices}
        bottomSheetRef={bottomSheetRef}
        initialScreen="SignIn"
        autoPresent={false}
        theme="light"
      >
        <View style={{ margin: 20 }}>
          {/* Use the built-in OxySignInButton for easy integration */}
          <OxySignInButton />
          
          {/* Or create your own custom button */}
          <Button 
            title="Custom Sign In" 
            onPress={() => bottomSheetRef.current?.expand()} 
          />
        </View>
      </OxyProvider>
    </GestureHandlerRootView>
  );
}
```

## Components

### OxyProvider

The main provider component that manages authentication state and exposes the bottom sheet for sign-in, sign-up, and account management.

### OxySignInButton

A pre-styled button component for signing in with Oxy services. This component automatically integrates with the OxyProvider context and will control the authentication bottom sheet when pressed.

```tsx
// Basic usage
<OxySignInButton />

// Custom styling
<OxySignInButton 
  variant="contained" 
  style={{ marginTop: 20 }} 
  text="Login with Oxy" 
/>
```

Available in three variants:
- `default`: A flat white button with a subtle shadow
- `outline`: A transparent button with a colored border
- `contained`: A solid colored button with white text

## Font Integration

The OxyProvider UI components use the Phudu variable font for titles and important UI elements, giving the interface a distinctive and cohesive look.

### Font Features

- **Phudu Variable Font**: Modern, distinctive font for titles and buttons
- **Automatic Font Loading**: Fonts automatically load when using the OxyProvider component
- **Platform Support**: Works on iOS, Android, and Web platforms

### Using the Fonts in Your App

To use the same fonts in your own components:

```tsx
import { fontStyles, fontFamilies } from '@oxyhq/services';

const MyComponent = () => (
  <View style={styles.container}>
    <Text style={styles.title}>My Title</Text>
    <Text style={styles.subtitle}>My Subtitle</Text>
  </View>
);

const styles = StyleSheet.create({
  title: {
    ...fontStyles.titleLarge,
    color: '#333333',
  },
  subtitle: {
    ...fontStyles.titleSmall,
    color: '#666666',
  },
});
```

For more information about font integration, please refer to the [Font Integration Guide](./FONT_INTEGRATION.md) and [Font Weight Handling](./FONT_WEIGHT_HANDLING.md) documentation.

## Documentation

For detailed documentation, see:
- [DOCS.md](./DOCS.md) - Complete API documentation
- [UI_COMPONENTS.md](./UI_COMPONENTS.md) - UI components documentation
- [Examples](./examples) - Working examples of integration

## License

MIT