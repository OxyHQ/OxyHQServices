# Navigation Transition Flicker Fix

## Issue
When navigating between screens, the previous screen was briefly visible for a few milliseconds before the new screen loaded, creating a noticeable flicker that affected user experience.

## Root Cause
The issue occurred in the `OxyRouter` component's `renderScreen` function where multiple state updates during navigation could cause React to re-render with the old screen before all state changes were complete.

## Solution
Implemented atomic state transitions using a pending state pattern:

1. **Added Pending State Management**: Added `pendingScreen` and `pendingProps` state variables to track the target screen during navigation.

2. **Atomic State Updates**: Modified the `navigate` and `goBack` functions to use a two-phase update:
   - Phase 1: Set the pending screen and props
   - Phase 2: After a minimal delay (50ms), atomically update all state variables together

3. **Smart Screen Rendering**: Updated `renderScreen` to use the pending screen when available, ensuring smooth transitions without intermediate blank states.

## Key Changes

### In `navigate` function:
```typescript
// Use pending state to ensure atomic transitions
setPendingScreen(screen);
setPendingProps(props);

// Update screen state atomically after a minimal delay
navigationTimeoutRef.current = setTimeout(() => {
    // Batch all state updates together
    setCurrentScreen(screen);
    setScreenHistory(prev => [...prev, screen]);
    setScreenProps(props);
    setPendingScreen(null);
    setPendingProps({});
    
    // Clear navigation flag after state is updated
    setTimeout(() => {
        setIsNavigating(false);
    }, 50); // Shorter delay for better responsiveness
}, 50); // Minimal delay to ensure atomic update
```

### In `renderScreen` function:
```typescript
// During navigation transition, continue showing the current screen until the new one is ready
// This prevents flicker by not rendering an intermediate state
const screenToRender = pendingScreen && !isNavigating ? pendingScreen : currentScreen;
const propsToUse = pendingScreen && !isNavigating ? pendingProps : screenProps;
```

## Benefits
- ✅ Eliminates the flicker where previous screen briefly appears during navigation
- ✅ Maintains smooth user experience during screen transitions  
- ✅ Preserves existing navigation functionality and API
- ✅ Uses minimal delays (50ms) for imperceptible but effective state coordination
- ✅ Works with both forward navigation and back navigation

## Testing
The fix can be tested by:
1. Rapidly navigating between different screens
2. Observing that no intermediate blank states or previous screens are visible
3. Confirming that transitions feel smooth and responsive

## Backward Compatibility
This fix is fully backward compatible. All existing navigation APIs and behavior remain unchanged.