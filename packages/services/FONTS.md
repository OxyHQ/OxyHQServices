# Inter Font - Oxy Ecosystem Typography Guide

Inter is the default font family for all apps in the Oxy ecosystem. This guide explains how to use Inter fonts in your application.

## Quick Start

### 1. Import the Font Setup

```typescript
import { FontLoader, setupFonts, fontFamilies, fontStyles } from '@oxyhq/services';
```

### 2. Load Fonts in Your App

#### React Native (with Expo)

Wrap your app root with `FontLoader`:

```tsx
import { FontLoader } from '@oxyhq/services';

export default function App() {
  return (
    <FontLoader>
      <YourAppContent />
    </FontLoader>
  );
}
```

The `FontLoader` component:
- Loads fonts asynchronously in the background
- Renders children immediately (system fonts are used as fallback)
- Automatically handles both web and native platforms

#### Alternative: Manual Setup

For more control, use `setupFonts()`:

```typescript
import { setupFonts } from '@oxyhq/services';

async function initializeApp() {
  await setupFonts();
  // Continue with app initialization
}
```

## Available Font Families

The `fontFamilies` constant provides all Inter weight variants:

```typescript
import { fontFamilies } from '@oxyhq/services';

const styles = StyleSheet.create({
  text: {
    fontFamily: fontFamilies.inter,        // Regular (400)
  },
  lightText: {
    fontFamily: fontFamilies.interLight,   // Light (300)
  },
  mediumText: {
    fontFamily: fontFamilies.interMedium,  // Medium (500)
  },
  semiBoldText: {
    fontFamily: fontFamilies.interSemiBold, // SemiBold (600)
  },
  boldText: {
    fontFamily: fontFamilies.interBold,    // Bold (700)
  },
  extraBoldText: {
    fontFamily: fontFamilies.interExtraBold, // ExtraBold (800)
  },
  blackText: {
    fontFamily: fontFamilies.interBlack,   // Black (900)
  },
});
```

### Platform Handling

The `fontFamilies` constant automatically handles platform differences:

- **Web**: Uses `'Inter'` with CSS font-weight
- **Native**: Uses specific font files (`'Inter-Bold'`, `'Inter-SemiBold'`, etc.)

You don't need to worry about platform detection - just use the constants!

## Pre-defined Font Styles

For common use cases, use the `fontStyles` constant:

```typescript
import { fontStyles } from '@oxyhq/services';

const styles = StyleSheet.create({
  largeTitle: {
    ...fontStyles.titleLarge,  // 54px, Bold
    color: '#000000',
  },
  mediumTitle: {
    ...fontStyles.titleMedium, // 24px, Bold
    color: '#000000',
  },
  smallTitle: {
    ...fontStyles.titleSmall,  // 20px, Bold
    color: '#000000',
  },
  button: {
    ...fontStyles.buttonText,  // 16px, SemiBold
    color: '#FFFFFF',
  },
});
```

## Best Practices

### ✅ DO

```typescript
// Use fontFamilies constant
import { fontFamilies } from '@oxyhq/services';

const styles = StyleSheet.create({
  text: {
    fontFamily: fontFamilies.interBold,
    fontSize: 18,
  },
});
```

```typescript
// Use fontStyles for common patterns
import { fontStyles } from '@oxyhq/services';

const styles = StyleSheet.create({
  title: {
    ...fontStyles.titleMedium,
    color: colors.text,
  },
});
```

### ❌ DON'T

```typescript
// Don't hardcode platform checks
const styles = StyleSheet.create({
  text: {
    fontFamily: Platform.OS === 'web' ? 'Inter' : 'Inter-Bold', // ❌
    fontSize: 18,
  },
});
```

```typescript
// Don't use raw font names
const styles = StyleSheet.create({
  text: {
    fontFamily: 'Inter-Bold', // ❌ Won't work on web
    fontSize: 18,
  },
});
```

## Font Weights Reference

| Weight Name | CSS Weight | Font File | fontFamilies Constant |
|-------------|------------|-----------|----------------------|
| Light | 300 | Inter_18pt-Light.ttf | `fontFamilies.interLight` |
| Regular | 400 | Inter_18pt-Regular.ttf | `fontFamilies.inter` |
| Medium | 500 | Inter_18pt-Medium.ttf | `fontFamilies.interMedium` |
| SemiBold | 600 | Inter_18pt-SemiBold.ttf | `fontFamilies.interSemiBold` |
| Bold | 700 | Inter_18pt-Bold.ttf | `fontFamilies.interBold` |
| ExtraBold | 800 | Inter_18pt-ExtraBold.ttf | `fontFamilies.interExtraBold` |
| Black | 900 | Inter_18pt-Black.ttf | `fontFamilies.interBlack` |

## Web-Specific Notes

On web platforms:
- All weights are loaded using CSS `@font-face` rules
- Font family is always `'Inter'`
- Use `fontWeight` CSS property alongside `fontFamily: 'Inter'`
- The `fontFamilies` constant handles this automatically

## Native-Specific Notes

On React Native:
- Each weight is a separate font file
- Don't use `fontWeight` with custom font families (it won't work)
- The specific font file name determines the weight
- The `fontFamilies` constant handles this automatically

## TypeScript Support

All exports are fully typed:

```typescript
import type { TextStyle } from 'react-native';
import { fontFamilies, fontStyles } from '@oxyhq/services';

// fontFamilies values are strings
const family: string = fontFamilies.interBold;

// fontStyles values are TextStyle objects
const style: TextStyle = fontStyles.titleLarge;
```

## Troubleshooting

### Fonts not loading on native

Make sure:
1. You're using `FontLoader` component or calling `setupFonts()`
2. The services package is properly installed
3. You're not using the fonts before they're loaded

### Fonts look different on web vs native

This is expected! Different platforms render fonts slightly differently. The `fontFamilies` constant ensures consistent weight selection across platforms.

### Can I use system fonts instead?

Yes, but it's not recommended for Oxy ecosystem apps. Inter provides:
- Consistent branding across all platforms
- Better cross-platform rendering
- Optimized readability at all sizes

## Migration from Phudu

If you're migrating from Phudu:

1. Replace all `fontFamilies.phudu*` with `fontFamilies.inter*`:
   ```typescript
   // Before
   fontFamily: fontFamilies.phuduBold

   // After
   fontFamily: fontFamilies.interBold
   ```

2. The `fontStyles` constants remain the same (already updated to Inter)

3. Remove any Phudu font files from your project

4. Update any hardcoded `'Phudu'` strings to use `fontFamilies` constants

## Support

For issues or questions:
- Check the [services package documentation](../README.md)
- Report issues at https://github.com/oxyhq/services/issues
