# OxyProvider Font Integration Guide

> **Note about Font Weights**: For issues with font weights (bold text) on React Native, plea1. **Manual Method**:
   - Copy the font files from `node_modules/@oxyhq/services/lib/commonjs/assets/fonts/Phudu/` to your public assets directory (e.g., `/public/assets/fonts/Phudu/`)
   - Add the following CSS to your project:
     ```css
     @font-face {
       font-family: 'Phudu';
       src: url('/assets/fonts/Phudu/Phudu-Light.ttf') format('truetype');
       font-weight: 300;
       font-style: normal;
     }
     @font-face {
       font-family: 'Phudu';
       src: url('/assets/fonts/Phudu/Phudu-Regular.ttf') format('truetype');
       font-weight: 400;
       font-style: normal;
     }
     /* Add other weights as needed: Medium (500), SemiBold (600), Bold (700), etc. */
     ``` the [Font Weight Handling guide](./FONT_WEIGHT_HANDLING.md).

## For Library Consumers

If you're using the OxyProvider component from this npm package, here's how to ensure the Phudu fonts work correctly:

### React Native Projects

1. **Automatic Method (with Expo)**:
   The fonts will be automatically loaded when you use the `OxyProvider` component.

2. **Manual Method (without Expo)**:
   - Copy the font files from `node_modules/@oxyhq/services/lib/commonjs/assets/fonts/Phudu/` directory to your project's assets directory
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
   - Copy the font files from `node_modules/@oxyhq/services/lib/commonjs/assets/fonts/Phudu/` directory to your public assets directory
   - Add the following CSS declarations:
   ```css
   @font-face {
     font-family: 'Phudu';
     src: url('/assets/fonts/Phudu/Phudu-Light.ttf') format('truetype');
     font-weight: 300;
     font-style: normal;
   }
   @font-face {
     font-family: 'Phudu';
     src: url('/assets/fonts/Phudu/Phudu-Regular.ttf') format('truetype');
     font-weight: 400;
     font-style: normal;
   }
   @font-face {
     font-family: 'Phudu';
     src: url('/assets/fonts/Phudu/Phudu-Medium.ttf') format('truetype');
     font-weight: 500;
     font-style: normal;
   }
   @font-face {
     font-family: 'Phudu';
     src: url('/assets/fonts/Phudu/Phudu-SemiBold.ttf') format('truetype');
     font-weight: 600;
     font-style: normal;
   }
   @font-face {
     font-family: 'Phudu';
     src: url('/assets/fonts/Phudu/Phudu-Bold.ttf') format('truetype');
     font-weight: 700;
     font-style: normal;
   }
   @font-face {
     font-family: 'Phudu';
     src: url('/assets/fonts/Phudu/Phudu-ExtraBold.ttf') format('truetype');
     font-weight: 800;
     font-style: normal;
   }
   @font-face {
     font-family: 'Phudu';
     src: url('/assets/fonts/Phudu/Phudu-Black.ttf') format('truetype');
     font-weight: 900;
     font-style: normal;
   }
   ```

## Font File Distribution

The OxyProvider package includes the Phudu font files in its distribution in the following locations:

- `lib/commonjs/assets/fonts/Phudu/`
- `lib/module/assets/fonts/Phudu/`

Including these static weight files:
- Phudu-Light.ttf (weight: 300)
- Phudu-Regular.ttf (weight: 400)
- Phudu-Medium.ttf (weight: 500)
- Phudu-SemiBold.ttf (weight: 600)
- Phudu-Bold.ttf (weight: 700)
- Phudu-ExtraBold.ttf (weight: 800)
- Phudu-Black.ttf (weight: 900)

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

- `lib/commonjs/assets/fonts/Phudu/`
- `lib/module/assets/fonts/Phudu/`

This is done via the `copy-assets` script in package.json to ensure the fonts are available in the npm package.
