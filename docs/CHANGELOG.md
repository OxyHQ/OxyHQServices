# Changelog

All notable changes to this project will be documented in this file.

## [5.2.0] - Multi-User Authentication System

### 🚀 New Features

#### Multi-User Authentication
- **Multiple Account Support**: Users can now sign in with multiple accounts simultaneously
- **Account Switcher**: Built-in UI component for seamless account switching
- **Session Management**: Comprehensive session management across devices
- **Remote Logout**: Ability to logout from specific sessions remotely
- **Enhanced Security**: Session tracking with device information and activity monitoring

#### Backend API Enhancements
- **Session Management Endpoints**: New `/sessions` API for managing user sessions
- **Device Tracking**: Enhanced session tracking with device information (platform, browser, OS, IP)
- **Session Activity**: Automatic session activity updates via authentication middleware
- **Remote Session Control**: API endpoints for remote session management

#### Frontend UI Components
- **AccountSwitcherScreen**: New screen for managing multiple accounts
- **SessionManagementScreen**: Interface for viewing and managing active sessions
- **Enhanced SignInScreen**: Automatic "Add Account" mode when user is authenticated
- **Enhanced AccountCenterScreen**: Added multi-user management buttons

#### Core Library Updates
- **Multi-User Context**: Enhanced `OxyContext` with multi-user state management
- **Session API Methods**: New methods for session management in `OxyServices` core
- **Storage Management**: Improved storage handling for multiple authenticated users
- **Legacy Migration**: Automatic migration from single-user to multi-user format

### 🔧 Technical Improvements

#### Backend
- **Session Model**: New MongoDB schema for session tracking
- **Session Utilities**: Extracted session management functions to prevent circular dependencies
- **Enhanced Auth Middleware**: Added automatic session activity tracking
- **Device Information**: Comprehensive device fingerprinting for security

#### Frontend
- **Context Architecture**: Restructured authentication context for multi-user support
- **Storage Optimization**: Efficient storage management for multiple user tokens
- **Token Validation**: Enhanced token validation during app initialization
- **Error Handling**: Improved error handling for multi-user scenarios

#### Security
- **Session Isolation**: Each user session is properly isolated
- **Token Security**: Secure token storage and management per user
- **Device Tracking**: Enhanced security monitoring through device tracking
- **Session Expiration**: Automatic cleanup of expired sessions

### 🛠️ API Changes

#### New Endpoints
```
GET    /sessions                    - List active sessions for user
DELETE /sessions/:sessionId         - Remote logout from specific session
POST   /sessions/logout-others      - Logout from all other sessions
POST   /sessions/logout-all         - Logout from all sessions
```

#### Enhanced Endpoints
```
POST   /auth/login                  - Now creates session records
GET    /auth/validate               - Enhanced with session validation
```

#### New Context Methods
```typescript
switchUser(userId: string): Promise<void>
removeUser(userId: string): Promise<void>
getUserSessions(userId?: string): Promise<SessionData[]>
logoutSession(sessionId: string, userId?: string): Promise<void>
logoutAll(): Promise<void>
```

### 📱 UI/UX Improvements

- **Seamless Account Switching**: Quick switching between authenticated accounts
- **Visual Account Indicators**: Clear indication of current active account
- **Session Visibility**: Users can see and manage all their active sessions
- **Device Information Display**: Sessions show device and location information
- **Bulk Operations**: Support for bulk session logout operations

### 🐛 Bug Fixes

- **Session Persistence**: Fixed issue where sessions were lost on app refresh
- **Circular Dependencies**: Resolved circular dependency in session management
- **Token Validation**: Fixed token validation race conditions during initialization
- **Storage Conflicts**: Resolved storage key conflicts between multiple users
- **User ID Consistency**: Fixed User ID field inconsistency (`_id` vs `id`)

### ⚠️ Breaking Changes

- **Storage Format**: Authentication storage format has changed (automatic migration included)
- **Context Interface**: `OxyContextState` interface has been extended with multi-user properties
- **Navigation Routes**: New navigation routes added for multi-user screens

### 🔄 Migration Guide

The library automatically handles migration from single-user to multi-user format. No manual intervention required.

For custom implementations:
1. Update imports to use the enhanced context methods
2. Handle the new multi-user state properties
3. Update UI to support multiple account scenarios

### 📚 Documentation Updates

- **Multi-User Authentication Guide**: Comprehensive documentation for the new system
- **API Reference**: Updated with new session management endpoints
- **UI Components Guide**: Documentation for new multi-user components
- **Security Best Practices**: Guidelines for secure multi-user implementation

### 🔍 Testing

- **Multi-User Scenarios**: Comprehensive testing across multiple user accounts
- **Session Management**: Testing of session creation, validation, and cleanup
- **Device Tracking**: Verification of device information collection
- **Storage Migration**: Testing of automatic migration from legacy format
- **Error Handling**: Edge case testing for network failures and token expiration

### 🚀 Future Enhancements

- **Push Notifications**: Session-specific push notification targeting
- **Advanced Security**: Geolocation-based session validation
- **Analytics Integration**: Session-based analytics and user behavior tracking
- **Offline Support**: Enhanced offline capabilities for multi-user scenarios

## [5.1.33] - 2025-05-26

### Changed
- **BREAKING**: Restructured package exports for better separation of concerns
- Main export (`@oxyhq/services`) now only includes core services and models (Node.js/server usage)
- UI components moved to dedicated export path (`@oxyhq/services/ui`)
- Added full package export (`@oxyhq/services/full`) for applications needing both core and UI
- Updated all documentation and examples to reflect new import structure

### Added
- New export maps in package.json for proper module resolution
- EXPORT_STRUCTURE.md guide explaining the new import paths
- Import guides in README.md, DOCS.md, and UI_COMPONENTS.md

### Migration Guide
- Replace `import { OxyProvider } from '@oxyhq/services'` with `import { OxyProvider } from '@oxyhq/services/ui'`
- Core services (`OxyServices`, `Models`) remain available from main export
- Use `@oxyhq/services/full` for applications needing both core and UI components

## [5.1.15] - 2025-05-21

### Added
- New animated `FollowButton` component for social interaction features
- Added smooth state transitions with color interpolation and scaling effects
- Loading state indicator for active API calls with showLoadingState prop
- Multiple size variants (small, medium, large) for flexible UI integration
- Added comprehensive documentation and examples for the FollowButton component
- FollowButtonExample.tsx showcasing different button configurations and states

## [5.1.8] - 2025-05-18

### Added
- New `Avatar` component for displaying user avatars with image or text fallback
- Added AvatarExample.tsx to demonstrate Avatar component usage and styling
- Updated AccountOverviewScreen to use the new Avatar component
- Added comprehensive documentation for Avatar component in UI_COMPONENTS.md

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
