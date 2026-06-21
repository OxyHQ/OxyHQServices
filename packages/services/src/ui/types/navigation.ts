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
    queryClient?: QueryClient;
    /**
     * When `true`, skips ONLY the terminal SSO bounce in the web cold-boot
     * chain — the force-redirect to `auth.<apex>/sso?prompt=none` that fires
     * for a visitor with no recoverable local session. This lets a truly
     * anonymous user keep browsing instead of being bounced to the central
     * IdP (e.g. a marketplace that allows anonymous browsing like eBay /
     * Shop.app).
     *
     * Session restore still runs in full: the callback consume, FedCM silent,
     * first-party `/auth/silent` iframe, stored-session bearer, and
     * cookie-restore steps all execute — so a returning signed-in user is
     * still silently restored. Only the force-bounce for a genuinely
     * anonymous visitor is suppressed.
     *
     * Default `false` (current behavior: the bounce fires).
     */
    disableAutoSso?: boolean;
}
