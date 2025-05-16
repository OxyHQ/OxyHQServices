# OxyProvider Font Integration Guide

## For Library Consumers

If you're using the OxyProvider component from this npm package, here's how to ensure the Phudu font works correctly:

### React Native Projects

1. **Automatic Method (with Expo)**:
   The font will be automatically loaded when you use the `OxyProvider` component.

2. **Manual Method (without Expo)**:
   - Copy the font file from `node_modules/@oxyhq/services/lib/commonjs/assets/fonts/Phudu-VariableFont_wght.ttf` to your project's assets directory
   - Link the fonts using React Native's font linking process:
     - For iOS: Add to Info.plist and include in the Xcode project
     - For Android: Place in `android/app/src/main/assets/fonts/`
   - Use `npx react-native-asset link` if available
   - Call `setupFonts()` before rendering your app

### Web Projects

1. **Automatic Method**:
   ```javascript
   import { setupFonts } from '@oxyhq/services';
   
   // Call this before rendering your app
   setupFonts();
   ```

2. **Manual Method**:
   - Copy the font file from `node_modules/@oxyhq/services/lib/commonjs/assets/fonts/Phudu-VariableFont_wght.ttf` to your public assets directory
   - Add a CSS declaration:
   ```css
   @font-face {
     font-family: 'Phudu';
     src: url('/assets/fonts/Phudu-VariableFont_wght.ttf') format('truetype');
     font-weight: 100 900;
     font-style: normal;
   }
   ```

## Font File Distribution

The OxyProvider package includes the Phudu font in its distribution in the following locations:

- `lib/commonjs/assets/fonts/Phudu-VariableFont_wght.ttf`
- `lib/module/assets/fonts/Phudu-VariableFont_wght.ttf`

This is handled during the build process with:
```json
"copy-assets": "copyfiles -u 1 \"src/assets/**/*\" lib/commonjs/assets && copyfiles -u 1 \"src/assets/**/*\" lib/module/assets"
```

## Components Using Phudu Font

The following components use the Phudu font:

1. **Screen Titles**: All main screen titles in SignInScreen, SignUpScreen, AccountCenterScreen, and AccountOverviewScreen
2. **Section Headers**: Section titles in AccountOverviewScreen
3. **Buttons**: The "Sign In with Oxy" button text

## Using in Custom Components

You can use the exported font utilities in your own components:

```javascript
import { fontStyles, fontFamilies } from '@oxyhq/services';

const styles = StyleSheet.create({
  myCustomTitle: {
    ...fontStyles.titleLarge,
    color: '#333333',
  },
  myCustomButton: {
    fontFamily: fontFamilies.phudu,
    fontSize: 18,
    fontWeight: '600',
  }
});
```

1. **Automatic Method**:
   The font will be automatically loaded when you use the `OxyProvider` component.

2. **Manual Method**:
   - Copy the font file from `node_modules/@oxyhq/services/lib/commonjs/assets/fonts/Phudu-VariableFont_wght.ttf` to your public assets directory (e.g., `/public/assets/fonts/`)
   - Add the following CSS to your project:
     ```css
     @font-face {
       font-family: 'Phudu';
       src: url('/assets/fonts/Phudu-VariableFont_wght.ttf') format('truetype');
       font-weight: 100 900;
       font-style: normal;
     }
     ```
   - If you're using bundlers like webpack, you may need to add proper asset loading configuration

## For Library Maintainers

The font files are automatically copied to the distribution folders during build:

- `lib/commonjs/assets/fonts/Phudu-VariableFont_wght.ttf`
- `lib/module/assets/fonts/Phudu-VariableFont_wght.ttf`

This is done via the `copy-assets` script in package.json to ensure the font is available in the npm package.
