# Bottom Sheet API Integration Improvements

This document outlines the improvements made to the bottom sheet functionality, router transitions, and API integration to resolve the "Maximum update depth exceeded" error and improve overall stability.

## Issues Fixed

### 1. Maximum Update Depth Exceeded Error

**Problem**: The error was caused by infinite re-render loops due to:
- useEffect dependencies that changed on every render
- Manual ref method forwarding in complex useEffect chains
- Unstable callback references

**Solution**: 
- Replaced `useCallback` with `useStableCallback` from state optimizations
- Simplified useEffect dependencies and reduced complex chains
- Implemented stable method assignment patterns

```typescript
// Before (caused infinite re-renders)
const handleMethod = useCallback(() => {
  // Complex logic with changing dependencies
}, [bottomSheetRef, modalRef, fadeAnim, slideAnim, autoPresent]);

// After (stable references)
const handleMethod = useStableCallback(() => {
  // Same logic with stable callback
}, [fadeAnim, slideAnim]);
```

### 2. Fallback Modal Issues

**Problem**: Fallback modal always had `visible={false}`, making it non-functional.

**Solution**: Added proper state management to the fallback modal:

```typescript
// Before
<Modal visible={false} ... />

// After  
const [visible, setVisible] = React.useState(false);
React.useImperativeHandle(ref, () => ({
  present: () => setVisible(true),
  dismiss: () => setVisible(false),
  // ... other methods
}));
<Modal visible={visible} ... />
```

### 3. Ref Method Forwarding

**Problem**: Complex manual method forwarding caused memory leaks and race conditions.

**Solution**: Simplified method forwarding with stable patterns:

```typescript
// Before (complex and unstable)
methodsToExpose.forEach((method) => {
  bottomSheetRef.current[method] = (...args) => {
    return modalRef.current?.[method]?.(...args);
  };
});

// After (stable and simple)
const methods = {
  present: () => {
    modalRef.current?.present();
    startPresentAnimation();
  },
  dismiss: () => modalRef.current?.dismiss(),
  // ... other methods
};

if (!bottomSheetRef.current?.present) {
  bottomSheetRef.current = methods;
}
```

### 4. Animation Memory Leaks

**Problem**: Animation values were not properly cleaned up on unmount.

**Solution**: Added proper cleanup using useEffect:

```typescript
useEffect(() => {
  return () => {
    // Clean up animations when component unmounts
    fadeAnim.stopAnimation();
    slideAnim.stopAnimation(); 
    handleScaleAnim.stopAnimation();
    animationGC.cleanup();
  };
}, [fadeAnim, slideAnim, handleScaleAnim]);
```

### 5. Router Navigation Race Conditions

**Problem**: Complex navigation logic with multiple fallbacks caused timing issues.

**Solution**: Simplified navigation with stable method assignment:

```typescript
// Stable navigation method assignment
useEffect(() => {
  if (bottomSheetRef?.current && navigationRef.current) {
    bottomSheetRef.current._navigateToScreen = (screenName, props) => {
      if (navigationRef.current) {
        navigationRef.current(screenName, props);
      }
    };
  }
}, [bottomSheetRef, navigationRef.current]);
```

## API Integration Patterns

### 1. Stable Context Methods

The context now provides stable methods that don't cause re-renders:

```typescript
const { showBottomSheet, hideBottomSheet } = useOxy();

// These methods are now stable and won't cause re-renders
showBottomSheet('SignIn');
showBottomSheet({ screen: 'AccountCenter', props: { userId: '123' } });
hideBottomSheet();
```

### 2. Error Handling

Improved error handling with proper warnings:

```typescript
const showBottomSheet = useStableCallback((screenOrConfig) => {
  if (bottomSheetRef?.current) {
    // Show bottom sheet
    if (bottomSheetRef.current.expand) {
      bottomSheetRef.current.expand();
    } else if (bottomSheetRef.current.present) {
      bottomSheetRef.current.present();
    }
    
    // Navigate if screen specified
    if (screenOrConfig) {
      setTimeout(() => {
        // Safe navigation with timeout
      }, 100);
    }
  } else {
    console.warn('bottomSheetRef is not available');
  }
}, [bottomSheetRef]);
```

### 3. Memory Management

Implemented proper memory management patterns:

```typescript
// Use garbage collection for cached data
const animationGC = new StateGarbageCollector({ 
  maxAge: 10 * 60 * 1000, // 10 minutes
  maxSize: 50 
});

// Clean up on unmount
useEffect(() => {
  return () => {
    animationGC.cleanup();
  };
}, []);
```

## Usage Examples

### Basic Usage

```typescript
import { OxyProvider, useOxy } from '@oxyhq/services';

const App = () => {
  const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });
  
  return (
    <OxyProvider oxyServices={oxyServices} autoPresent={false}>
      <MyComponent />
    </OxyProvider>
  );
};

const MyComponent = () => {
  const { showBottomSheet, hideBottomSheet } = useOxy();
  
  return (
    <Button 
      onPress={() => showBottomSheet('SignIn')}
      title="Show Sign In"
    />
  );
};
```

### Advanced Usage with Navigation

```typescript
const handleShowProfile = () => {
  showBottomSheet({
    screen: 'ProfileScreen',
    props: {
      userId: currentUser.id,
      initialTab: 'settings'
    }
  });
};
```

### Context Only Mode

```typescript
// For apps that want to manage their own UI
<OxyProvider oxyServices={oxyServices} contextOnly={true}>
  <MyCustomBottomSheet />
</OxyProvider>
```

## Performance Improvements

1. **Reduced Re-renders**: Stable callbacks prevent unnecessary component re-renders
2. **Memory Efficiency**: Proper animation cleanup and garbage collection
3. **Faster Transitions**: Simplified method forwarding reduces overhead
4. **Better Error Handling**: Graceful degradation when components aren't available

## Migration Guide

If you're upgrading from a previous version:

1. **No Breaking Changes**: All existing APIs remain the same
2. **Better Performance**: You should notice smoother animations and fewer re-renders
3. **Improved Stability**: No more "Maximum update depth exceeded" errors
4. **Enhanced Error Handling**: Better warnings and fallback behavior

## Testing

The fixes have been validated through:
- Core logic validation (method forwarding, state management)
- Animation cleanup testing
- Context method stability verification
- Error handling scenarios
- Memory leak prevention

All tests pass and confirm the improvements work as expected.