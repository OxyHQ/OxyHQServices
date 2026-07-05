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
     * Convenience: wrap the whole app subtree in `<RequireOxyAuth prompt=...>`.
     * `off` (default) renders children unconditionally; `soft` adds a dismissible
     * sign-in banner while signed out; `hard` blocks the app behind the signed-out
     * wall until the user signs in. For finer control, mount `RequireOxyAuth`
     * yourself around a specific subtree instead.
     * @default 'off'
     */
    requireAuth?: 'off' | 'soft' | 'hard';
    /**
     * Whether this provider acts as the ecosystem's device-first **session
     * authority**. `true` (default) runs the full device-first cold boot on
     * mount (bootstrap-return → stored tokens → shared key / bootstrap hop) and
     * opens the signed-out device-state socket so an idle tab self-acquires when
     * a sibling signs in — the correct behavior for every Relying Party app.
     *
     * Set `false` for the **IdP host** (`auth.oxy.so`): the IdP is NOT a session
     * authority (see the handoff "IdP vs RP" section). With `coldBoot={false}`
     * the provider skips `runSessionColdBoot` entirely and never opens the
     * signed-out device socket — auth resolves immediately as signed out (no
     * boot spinner). Interactive sign-in is unaffected: a user who signs in
     * through this provider (password, 2FA, or the "Sign in with Oxy" QR device
     * flow) still commits a normal session scoped to this origin, which is all
     * the IdP needs to drive its OAuth authorize/consent flow.
     * @default true
     */
    coldBoot?: boolean;
}
