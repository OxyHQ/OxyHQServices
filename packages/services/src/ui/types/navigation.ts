import type { ReactNode, RefObject } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { RouteName } from '../navigation/routes';
import type { User } from '@oxyhq/core';
import type { ClientSession } from '@oxyhq/core';

export interface StepController {
    canGoBack: () => boolean;
    goBack: () => void;
}

export interface BaseScreenProps {
    // Navigation props
    navigate?: (screen: RouteName, props?: Record<string, unknown>) => void;
    goBack?: () => void;
    onClose?: () => void;
    onAuthenticated?: (payload?: unknown) => void;
    
    // Theme props
    theme?: 'light' | 'dark' | string;
    
    // Step-based screen props
    initialStep?: number;
    stepControllerRef?: RefObject<StepController | null>;
    onStepChange?: (currentStep: number, totalSteps: number) => void;
    
    // Screen identification
    currentScreen?: RouteName;
    
    // Scroll control
    scrollTo?: (y: number, animated?: boolean) => void;
    
    // Form props (for sign in/up flows)
    username?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
    userProfile?: unknown;
    
    // Note: OxyContext values (user, sessions, login, etc.) should be accessed via useOxy() hook
    // This keeps props minimal and follows React best practices
    
    // Allow additional props for screen-specific data
    [key: string]: unknown;
}

export interface OxyProviderProps {
    oxyServices?: unknown;
    children?: ReactNode;
    onAuthStateChange?: (user: unknown) => void;
    storageKeyPrefix?: string;
    /**
     * The app's Oxy OAuth client id / ApplicationCredential publicKey.
     * Required for the cross-app device sign-in flow: the QR / approval-window
     * sign-in registers a device-flow session via `POST /auth/session/create`,
     * which now identifies the requesting app by this real registered
     * client id. The central Oxy auth experience resolves and renders the
     * consent identity from it server-side. Without it the device sign-in
     * flow cannot start.
     */
    clientId?: string;
    baseURL?: string;
    authWebUrl?: string;
    authRedirectUri?: string;
    /**
     * Authorize endpoint override for silent cross-origin session restore
     * (web cross-app SSO on cold boot). Defaults to the production Oxy IdP
     * (`https://auth.oxy.so/authorize`) when unset. Set this from an env var
     * (e.g. Vite `VITE_OXY_AUTHORIZE_URL`, Expo `EXPO_PUBLIC_OXY_AUTHORIZE_URL`)
     * so a local/staging deployment targets its own IdP instead of production.
     */
    authorizeBaseUrl?: string;
    queryClient?: QueryClient;
    /** Sync device credentials to auth.oxy.so after interactive sign-in. @default true */
    hubSync?: boolean;
    /**
     * Convenience: wrap the whole app subtree in `<RequireOxyAuth prompt=...>`.
     * `off` (default) renders children unconditionally; `soft` adds a dismissible
     * sign-in banner while signed out; `hard` blocks the app behind the signed-out
     * wall until the user signs in. For finer control, mount `RequireOxyAuth`
     * yourself around a specific subtree instead.
     * @default 'off'
     */
    requireAuth?: 'off' | 'soft' | 'hard';
}
