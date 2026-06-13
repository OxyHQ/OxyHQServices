/**
 * @oxyhq/services/ui — public subpath
 *
 * Tree-shakeable static re-exports of the most common UI surface. Backend
 * environments (SSR) should import `@oxyhq/services/ui/server` instead;
 * client-only callers can use `@oxyhq/services/ui/client` for a slightly
 * narrower bundle.
 *
 * Static `export ... from` only — no runtime `require()`, no platform
 * conditionals. The previous `if (isFrontend) require(...)` pattern was
 * removed because it (a) violated the dual CJS/ESM build rule (ESM bundles
 * cannot contain `require()` per CLAUDE.md) and (b) defeated tree-shaking.
 */

// Components
export { default as OxyProvider } from './components/OxyProvider';
export { default as OxySignInButton } from './components/OxySignInButton';
export { default as OxyAuthPrompt } from './components/OxyAuthPrompt';
export type { OxyAuthPromptProps } from './components/OxyAuthPrompt';
export { default as OxyLogo } from './components/OxyLogo';
export { default as Avatar } from './components/Avatar';
export { default as FollowButton } from './components/FollowButton';
export { default as OxyPayButton } from './components/OxyPayButton';
export { FontLoader, setupFonts } from './components/FontLoader';
export { default as OxyIcon } from './components/icon/OxyIcon';
export { default as AccountMenu } from './components/AccountMenu';
export { default as AccountMenuButton } from './components/AccountMenuButton';

// Context + hooks
export { useOxy } from './context/OxyContext';
export { useAuth } from './hooks/useAuth';
export { useFollow } from './hooks/useFollow';
export { useStorage } from './hooks/useStorage';
export type { UseStorageOptions, UseStorageResult } from './hooks/useStorage';

// Screens
export { default as ProfileScreen } from './screens/ProfileScreen';
export { default as ManageAccountScreen } from './screens/ManageAccountScreen';

// Stores
export { useAuthStore } from './stores/authStore';
export { useAccountStore } from './stores/accountStore';

// Error handlers (pure functions)
export {
    handleAuthError,
    isInvalidSessionError,
    isTimeoutOrNetworkError,
    extractErrorMessage,
} from './utils/errorHandlers';
export type { HandleAuthErrorOptions } from './utils/errorHandlers';
