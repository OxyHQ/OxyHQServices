# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

#### Custom Bottom Sheet Implementation

- **Removed `@gorhom/bottom-sheet` dependency**
  - Replaced with custom bottom sheet implementation using `react-native-reanimated` v4
  - Built with `react-native-gesture-handler` for smooth pan gestures
  - Maintains same API (`present()`, `dismiss()`) for backward compatibility
  - Improved performance with native animations
  - Cleaner codebase without external bottom sheet library

- **Updated Components**
  - `BottomSheet.tsx` - New custom implementation
  - `BottomSheetProvider.tsx` - New provider component (API compatibility)
  - `BottomSheetRouter.tsx` - Updated to use custom BottomSheet
  - `OxyProvider.tsx` - Updated to use custom BottomSheetProvider

### Added

#### Bottom Sheet Routing System

- **Reusable Bottom Sheet Component** (`packages/services/src/ui/components/BottomSheet.tsx`)
  - Custom implementation built with `react-native-reanimated` v4
  - Uses `react-native-gesture-handler` for smooth pan gestures
  - Dynamic content sizing - automatically measures and adjusts height to fit content
  - Smooth spring animations for open/close transitions
  - Pan-down-to-close gesture support
  - Customizable backdrop, handle, and background styles
  - Safe area insets and keyboard handling

- **Bottom Sheet Router** (`packages/services/src/ui/components/BottomSheetRouter.tsx`)
  - Complete routing system for bottom sheet screens
  - Navigation history stack with back navigation support
  - Step-based screen navigation support
  - Automatic screen component loading and rendering
  - Dependency injection pattern - screens receive OxyContext values as props

- **Screen Registry System** (`packages/services/src/ui/navigation/routes.ts`)
  - Lazy-loaded screen registry to prevent require cycles
  - Dynamic `require()` calls with component caching
  - Type-safe route names with TypeScript
  - Support for 25+ pre-built screens (SignIn, SignUp, AccountSettings, etc.)

- **State Management** (`packages/services/src/ui/navigation/bottomSheetManager.ts`)
  - Pure state management module (no React dependencies)
  - Navigation history tracking
  - Current screen and step tracking
  - State subscription system for reactive updates

- **Public API** (`packages/services/src/ui/navigation/bottomSheetApi.ts`)
  - `showBottomSheet()` - Open any screen in bottom sheet
  - `closeBottomSheet()` - Close the bottom sheet
  - Route validation and error handling
  - Clean API that breaks require cycles

- **Navigation History**
  - Full back navigation support
  - History stack maintains screen and props
  - Step navigation doesn't pollute history
  - Smart back navigation: screen history → step navigation → close

- **Step-Based Screen Support**
  - Multi-step screen flows (e.g., SignIn, SignUp)
  - Step navigation within same screen
  - Step history tracking
  - `initialStep` prop support for starting at specific step

- **Keyboard Handling**
  - Automatic bottom padding adjustment when keyboard appears
  - Platform-specific keyboard event listeners (iOS: `keyboardWillShow`, Android: `keyboardDidShow`)
  - Respects safe area insets
  - Configurable keyboard behavior (`interactive`, `fillParent`, `extend`)

- **Type Safety**
  - Full TypeScript support throughout
  - Type-safe route names
  - Typed screen props via `BaseScreenProps`
  - Type-safe navigation functions

### Changed

#### Architecture Improvements

- **Dependency Injection Pattern**
  - Screens no longer directly import `useOxy()` hook
  - All OxyContext values passed as props to screens
  - Eliminates require cycles between screens and OxyContext
  - Cleaner, more professional architecture

- **Lazy Loading Implementation**
  - Converted screen registry to lazy loading
  - Screens loaded on-demand using dynamic `require()`
  - Component caching to avoid re-requiring
  - Breaks circular dependencies

- **State Management Refactoring**
  - Separated pure state management from React components
  - `bottomSheetManager.ts` - pure state (no React)
  - `bottomSheetApi.ts` - public API layer
  - `BottomSheetRouter.tsx` - React component layer

#### Navigation Improvements

- **Smart Navigation Detection**
  - Same-screen navigation (step changes) doesn't add to history
  - Only different-screen navigation adds to history
  - Prevents history pollution from step navigation

- **Back Navigation Priority**
  - Priority 1: Screen history (navigate to previous screen)
  - Priority 2: Step navigation (go to previous step)
  - Priority 3: Close sheet (if no history and on step 0)

- **Step Navigation Handling**
  - Proper step updates for same-screen navigation
  - `initialStep` prop properly handled in all scenarios
  - Step changes tracked via `onStepChange` callback

### Fixed

- **Require Cycle Warnings**
  - Eliminated all require cycle warnings
  - Implemented lazy loading for screen components
  - Used dependency injection to break cycles

- **Navigation History Issues**
  - Fixed `goBack()` closing sheet instead of navigating back
  - Fixed step navigation polluting history
  - Fixed back navigation priority order

- **Step Navigation**
  - Fixed step updates not being applied correctly
  - Fixed `initialStep` prop not being respected
  - Fixed step changes not being tracked

- **Keyboard Handling**
  - Fixed bottom sheet content being obscured by keyboard
  - Fixed keyboard height not being added to padding
  - Fixed platform-specific keyboard event handling

- **Dynamic Sizing**
  - Fixed `CONTENT_HEIGHT` snap point error
  - Correctly implemented dynamic sizing by omitting `snapPoints` prop
  - Fixed bottom sheet not sizing to content

### Technical Details

#### Files Added

- `packages/services/src/ui/components/BottomSheet.tsx` - Reusable bottom sheet component
- `packages/services/src/ui/components/BottomSheetRouter.tsx` - Router component
- `packages/services/src/ui/navigation/routes.ts` - Screen registry (lazy loading)
- `packages/services/src/ui/navigation/bottomSheetManager.ts` - State management
- `packages/services/src/ui/navigation/bottomSheetApi.ts` - Public API
- `packages/services/docs/BOTTOM_SHEET_ROUTING.md` - Complete documentation

#### Files Modified

- `packages/services/src/ui/context/OxyContext.tsx` - Added `showBottomSheet` to context
- `packages/services/src/ui/types/navigation.ts` - Extended `BaseScreenProps` with OxyContext values
- `packages/services/src/ui/components/OxyProvider.tsx` - Added BottomSheetRouter to component tree
- All screen components - Refactored to use dependency injection instead of `useOxy()`

#### Dependencies

- `react-native-gesture-handler` v2+ - Required for bottom sheet gestures
- `react-native-safe-area-context` - Safe area insets
- `react-native-reanimated` v4+ - Animations (peer dependency, used for custom bottom sheet)

### Migration Guide

#### For Existing Code

If you were using a previous bottom sheet implementation:

1. **Update imports**: Use `showBottomSheet` from `useOxy()` hook
2. **Remove custom bottom sheet code**: The new system is integrated
3. **Update screen navigation**: Use route names instead of component references

#### Example Migration

**Before:**
```typescript
// Custom bottom sheet implementation
const [isOpen, setIsOpen] = useState(false);
<CustomBottomSheet isOpen={isOpen}>
  <SignInScreen />
</CustomBottomSheet>
```

**After:**
```typescript
// New integrated system
const { showBottomSheet } = useOxy();
showBottomSheet('SignIn');
```

### Performance Improvements

- **Lazy Loading**: Screens only loaded when needed
- **Component Caching**: Loaded components cached to avoid re-requiring
- **Optimized Re-renders**: Using `React.memo`, `useCallback`, `useMemo`
- **Efficient State Updates**: Minimal state updates, batched where possible

### Breaking Changes

None - This is a new feature addition. Existing code continues to work.

### Deprecations

None

### Security

- No security-related changes in this release

### Documentation

- Added comprehensive bottom sheet routing documentation
- Added API reference for navigation functions
- Added usage examples and best practices
- Added troubleshooting guide

---

## Previous Releases

[Previous changelog entries would go here]

