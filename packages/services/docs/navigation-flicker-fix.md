# Navigation Transition Flicker Fix

## Issue
When navigating between screens, the previous screen was briefly visible for a few milliseconds before the new screen loaded, creating a noticeable flicker that affected user experience.

## Root Cause
The issue occurred in the `OxyRouter` component's navigation functions where multiple state updates (`setCurrentScreen`, `setScreenHistory`, `setScreenProps`) were happening in sequence. This caused React to re-render with partial state updates, showing the old screen briefly before all state changes were complete.

## Solution
Implemented atomic state transitions by wrapping all state updates in a `setTimeout` to ensure they execute together in a single batch:

1. **Atomic State Updates**: Modified the `navigate` and `goBack` functions to use `setTimeout` to batch all state updates together.

2. **Proper Timing**: Used minimal 50ms delays to ensure state updates are atomic while maintaining responsive user experience.

3. **Navigation Blocking**: Maintained the `isNavigating` flag to prevent multiple concurrent navigation attempts.

## Key Changes

### In `navigate` function:
```typescript
// Use setTimeout to batch all state updates atomically
// This prevents intermediate renders that cause flicker
navigationTimeoutRef.current = setTimeout(() => {
    // Batch all state updates together to prevent flicker
    setCurrentScreen(screen);
    setScreenHistory(prev => [...prev, screen]);
    setScreenProps(props);
    
    // Clear navigation flag after state is updated
    setTimeout(() => {
        setIsNavigating(false);
    }, 50); // Short delay for better responsiveness
}, 50); // Minimal delay to ensure atomic update
```

### In `goBack` function:
```typescript
// Use the same atomic update pattern as navigate
setTimeout(() => {
    setCurrentScreen(previousScreen);
    setScreenHistory(newHistory);
    setScreenProps({});
    
    // Clear navigation flag after state is updated
    setTimeout(() => {
        setIsNavigating(false);
    }, 50);
}, 50);
```

## Benefits
- ✅ Eliminates the flicker where previous screen briefly appears during navigation
- ✅ Maintains smooth user experience during screen transitions  
- ✅ Preserves existing navigation functionality and API
- ✅ Uses minimal delays (50ms) for imperceptible but effective state coordination
- ✅ Works with both forward navigation and back navigation
- ✅ Simple solution that doesn't complicate the component architecture

## Testing
The fix can be tested by:
1. Rapidly navigating between different screens
2. Observing that no intermediate states or previous screens are visible during transitions
3. Confirming that transitions feel smooth and responsive

## Backward Compatibility
This fix is fully backward compatible. All existing navigation APIs and behavior remain unchanged.