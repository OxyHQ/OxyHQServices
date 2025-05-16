# Changelog

All notable changes to this project will be documented in this file.

## [5.1.7] - 2025-05-16

### Added
- Integrated Phudu variable font for all titles and important UI text elements
- New `OxyLogo` SVG component for consistent branding across applications
- Enhanced `OxyLogo` with customizable colors via fillColor and secondaryFillColor props
- Improved UI components with updated branding and styling using #d169e5 as primary color
- Standardized button border radius to 35px for a more modern look
- Enhanced `OxySignInButton` with variant-specific logo styling and Phudu font
- Updated examples to showcase the new branding elements
- Added font documentation: FONT_INTEGRATION.md and FONT_WEIGHT_HANDLING.md

### Improved
- Removed navigation delay in bottom sheet transitions for a more responsive user experience
- Made sign-in flow transitions instant instead of using setTimeout delays
- Deprecated unused navigationDelay parameter in OxySignInButton

## [5.1.6] - 2025-05-16

### Added
- New `OxySignInButton` component for easy integration of sign-in functionality
- UI_COMPONENTS.md documentation file with detailed information about available UI components
- Updated examples to demonstrate the use of OxySignInButton

## [5.1.5] - 2025-05-15

### Fixed
- Fixed bottom sheet not appearing/opening on native platforms in the OxyProvider component
- Added support for programmatic control of the bottom sheet via the new `bottomSheetRef` prop
- Improved animation and layout behavior for a smoother experience across all platforms
- Enhanced documentation for native platform integration

### Added
- New `bottomSheetRef` prop for programmatic control of the OxyProvider's bottom sheet
- Example demonstrating how to use the bottomSheetRef prop

## [5.1.4] - (Previous release)

(Previous changelog entries would go here)
