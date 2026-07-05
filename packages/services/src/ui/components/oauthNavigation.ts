/**
 * Platform navigation for the third-party "Sign in with Oxy" OAuth flow.
 *
 * Kept out of `OxySignInButton` so the button's routing logic can be unit-tested
 * without driving a real browser navigation (jsdom's `location.assign` is
 * non-configurable and cannot be spied). Both entry points hand a fully-built
 * `auth.oxy.so/authorize` URL to the platform — never FedCM, an SSO bounce, or
 * an Oxy session cookie.
 */

import { Linking } from 'react-native';
import { logger } from '@oxyhq/core';

/** Minimal shape of the optional `expo-web-browser` native module we depend on. */
interface WebBrowserModule {
    openAuthSessionAsync?: (url: string, redirectUrl: string) => Promise<unknown>;
}

/**
 * Web: hand the TOP-LEVEL document to the OAuth authorize URL (a full-page
 * redirect, not a popup) so the RP returns to its registered `redirect_uri`.
 * No-op where `location` is unavailable (SSR / non-browser hosts).
 */
export function redirectToAuthorize(url: string): void {
    (globalThis as { location?: Location }).location?.assign(url);
}

/**
 * Native: open the authorize URL in an in-app auth session via the optional
 * `expo-web-browser` module (`openAuthSessionAsync` returns to `redirectUri`),
 * degrading to `Linking.openURL` when the module is not installed — the same
 * dynamic-import-with-fallback pattern services uses for haptics/netinfo.
 */
export async function openAuthorizeUrlNative(url: string, redirectUri: string): Promise<void> {
    try {
        const mod = (await import('expo-web-browser')) as unknown as WebBrowserModule;
        if (mod && typeof mod.openAuthSessionAsync === 'function') {
            await mod.openAuthSessionAsync(url, redirectUri);
            return;
        }
    } catch (error) {
        logger.warn(
            'OxySignInButton: expo-web-browser unavailable; falling back to Linking.openURL',
            { component: 'oauthNavigation' },
            error,
        );
    }
    await Linking.openURL(url);
}
