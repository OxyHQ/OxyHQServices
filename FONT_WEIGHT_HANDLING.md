# Font Weight Handling in React Native

## Problem
Variable fonts like Phudu may not display proper weights on native platforms (iOS/Android) even though they work correctly on web.

## Cause
1. React Native's font handling differs significantly from web browsers
2. Variable fonts on React Native may not respect CSS-like font weight declarations
3. Some platforms might require explicit font name registration for each weight

## Solution

We've implemented the following approach to ensure proper font weights across platforms:

### 1. Register multiple font names for the same font file

```typescript
// In FontLoader.tsx
await Font.loadAsync({
  'Phudu-Variable': phuduFont,
  'Phudu-Variable-Bold': phuduFont, // Same font file but registered with explicit bold name
});
```

### 2. Define platform-specific font family references

```typescript
// In fonts.ts
export const fontFamilies = {
  phudu: Platform.select({
    web: 'Phudu',  // Web projects use standard CSS name
    default: 'Phudu-Variable'  // Default name for regular weight
  }),
  phuduBold: Platform.select({
    web: 'Phudu',  // Web can use same name with CSS fontWeight
    default: 'Phudu-Variable-Bold'  // Native platforms need explicit bold name
  }),
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
