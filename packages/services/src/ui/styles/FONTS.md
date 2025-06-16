# Font Implementation Guide

## Overview
This document explains how custom fonts are implemented in the OxyProvider UI components.

## Implementation Details

### Fonts Used
- **Phudu Font Family**: Used for all big titles in the application for a consistent brand experience.
  - File location: `src/assets/fonts/Phudu/` directory containing:
    - Phudu-Light.ttf (weight: 300)
    - Phudu-Regular.ttf (weight: 400)
    - Phudu-Medium.ttf (weight: 500)
    - Phudu-SemiBold.ttf (weight: 600)
    - Phudu-Bold.ttf (weight: 700)
    - Phudu-ExtraBold.ttf (weight: 800)
    - Phudu-Black.ttf (weight: 900)

### How to Use
The font system has been implemented across all UI components. To use the fonts in your custom components:

```javascript
// Import the font styles
import { fontStyles, fontFamilies } from '@oxyhq/services';

// Use in your component styles
const styles = StyleSheet.create({
  myTitle: {
    ...fontStyles.titleLarge,
    color: '#333333',
  },
  myCustomHeading: {
    fontFamily: fontFamilies.phudu,
    fontSize: 28,
    fontWeight: '600',
  }
});
```

### Available Font Styles
- `titleLarge`: 34px, bold - For main screen titles
- `titleMedium`: 24px, bold - For section headings
- `titleSmall`: 20px, bold - For subsection headings

### Font Loading
The OxyProvider component automatically handles font loading using the FontLoader component.

#### For Expo projects
Fonts are loaded automatically via `expo-font` when you use the `OxyProvider` component.

#### For React Native projects (non-Expo)
Call the `setupFonts` function at your app's entry point:

```javascript
import { setupFonts } from '@oxyhq/services';

// Call this before rendering your app
setupFonts();

// Then render your app with OxyProvider
const App = () => (
  <OxyProvider>
    {/* Your app content */}
  </OxyProvider>
);
```

Also ensure the font files are properly linked in your native projects:
- For iOS: Add the font file to Xcode project and add entry to Info.plist
- For Android: Place the font in android/app/src/main/assets/fonts/

#### For Web projects
The `setupFonts` function will dynamically add the necessary @font-face CSS to load the Phudu font. 
The font will be automatically located if you use a bundler that supports asset imports.

If automatic resolution fails, the library will look for the font files in the `/assets/fonts/Phudu/` directory in your web build.

To customize the font paths for web, modify the `setupFonts` function in your own implementation:

```javascript
// Custom implementation
import { setupFonts as originalSetupFonts } from '@oxyhq/services';

export const setupFonts = () => {
  // Your custom font loading logic for web
  if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    
    // Add custom @font-face rules with your own font paths
    const customFontPathBase = '/path/to/your/fonts/Phudu/';
    
    style.textContent = `
      @font-face {
        font-family: 'Phudu';
        src: url('${customFontPathBase}Phudu-Regular.ttf') format('truetype');
        font-weight: 400;
        font-style: normal;
      }
      @font-face {
        font-family: 'Phudu';
        src: url('${customFontPathBase}Phudu-Bold.ttf') format('truetype');
        font-weight: 700;
        font-style: normal;
      }
      /* Add other weights as needed */
    `;
    
    document.head.appendChild(style);
  } else {
    // Use the original implementation for native platforms
    originalSetupFonts();
  }
};
```

### Platform Support
- **iOS/Android**: Loaded as individual font files ('Phudu-Regular', 'Phudu-Bold', etc.)
- **Web**: Uses the font name 'Phudu' with specific weights via CSS weight property

### Custom Font Implementation
If you want to add additional fonts:

1. Add the font file to `src/assets/fonts/`
2. Update the `fontFamilies` object in `src/ui/styles/fonts.ts`
3. Update the `FontLoader` component in `src/ui/components/FontLoader.tsx`
4. For web support, include the font in your web project's CSS
