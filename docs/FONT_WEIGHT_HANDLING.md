# Font Weight Handling in React Native

## Problem
Font weights need to be properly managed on native platforms (iOS/Android) to ensure consistent appearance across platforms.

## Cause
1. React Native's font handling differs significantly from web browsers
2. Native platforms may not properly handle font-weight on a single font file
3. Each weight typically needs its own font file on native platforms

## Solution

We've implemented the following approach to ensure proper font weights across platforms:

### 1. Use static font files for each weight

```typescript
// In FontLoader.tsx
const phuduFonts = {
  'Phudu-Regular': require('../../assets/fonts/Phudu/Phudu-Regular.ttf'),
  'Phudu-Bold': require('../../assets/fonts/Phudu/Phudu-Bold.ttf'),
  // Other weights...
};

await Font.loadAsync(phuduFonts);
```

### 2. Use platform-specific fontFamily and fontWeight

```typescript
// In your style definitions
{
  fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
  fontWeight: Platform.OS === 'web' ? 'bold' : undefined, // Only apply fontWeight on web
}
```

This is the key change. For web, we use CSS font names and weights, but for native platforms:
- Use the exact font name as registered with Font.loadAsync (e.g., 'Phudu-Bold')
- Do not set fontWeight on native platforms as it won't apply correctly

### 3. Define platform-specific font family references (LEGACY)

```typescript
// Old approach in fonts.ts - DEPRECATED
export const fontFamilies = {
  phudu: Platform.select({
    web: 'Phudu',  // Web projects use standard CSS name with weight
    default: 'Phudu-Regular'  // Default name for regular weight
  }),
  phuduBold: Platform.select({
    web: 'Phudu',  // Web can use same name with CSS fontWeight
    default: 'Phudu-Bold'  // Native platforms use specific font
  }),
  phuduMedium: Platform.select({
    web: 'Phudu',  // Web can use same name with CSS fontWeight
    default: 'Phudu-Medium'  // Native platforms use specific font
  }),
  // Other weights defined similarly...
};
```

### 3. Use platform-specific font families for different weights

```typescript
// In component styles
const styles = StyleSheet.create({
  boldText: {
    fontFamily: Platform.select({
      web: fontFamilies.phudu, // On web, we use regular name + fontWeight
      default: fontFamilies.phuduBold // On native, we use specific bold font name
    }),
    fontWeight: 'bold', // This is still needed for web
  }
});
```

## Testing Font Weight

To check if font weights are displaying correctly:

1. On Web: Use browser dev tools to inspect the element
2. On iOS: Use the Debug -> View Hierarchy in Xcode
3. On Android: Use the Layout Inspector in Android Studio

## Additional Resources

- [React Native Font Documentation](https://reactnative.dev/docs/text-style-props#fontweight)
- [Variable Fonts Guide](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_fonts/Variable_fonts_guide)
