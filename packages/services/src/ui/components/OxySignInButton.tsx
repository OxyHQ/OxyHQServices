import type React from 'react';
import { useCallback, useState, useEffect, useRef } from 'react';
import { type ViewStyle, type TextStyle, type StyleProp, Platform } from 'react-native';
import {
    logger,
    generatePkcePair,
    generateOAuthState,
    buildOAuthAuthorizeUrl,
    type PublicApplication,
} from '@oxyhq/core';
import { useAuthStore } from '../stores/authStore';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '@oxyhq/bloom/theme';
import { Button, type ButtonVariant } from '@oxyhq/bloom/button';
import { useOxy } from '../context/OxyContext';
import { LogoIcon } from './logo/LogoIcon';
import { subscribeToSignInModal } from '../navigation/accountDialogManager';
import { redirectToAuthorize, openAuthorizeUrlNative } from './oauthNavigation';

/**
 * `sessionStorage` keys under which a third-party "Sign in with Oxy" OAuth flow
 * persists its CSRF `state` and PKCE `code_verifier` across the authorize
 * redirect. The Relying Party's redirect-URI callback reads them back to
 * validate the returned `state` and replay the verifier on the token exchange.
 *
 * Web only: a browser RP navigates away to `auth.oxy.so` and back, so the
 * handshake must survive a full-page redirect. Native completes the flow inside
 * a single `WebBrowser` auth session and surfaces the handshake via
 * {@link OxySignInButtonProps.onOAuthResult} instead.
 */
export const OXY_OAUTH_STATE_STORAGE_KEY = 'oxy_oauth_state';
export const OXY_OAUTH_CODE_VERIFIER_STORAGE_KEY = 'oxy_oauth_code_verifier';

/**
 * The OAuth handshake surfaced to a NATIVE third-party RP via
 * {@link OxySignInButtonProps.onOAuthResult} so it can finish the code exchange
 * (`POST /auth/oauth/token`). Web RPs read the same `state` / `code_verifier`
 * back from `sessionStorage` across the redirect and do not need this callback.
 */
export interface OxyOAuthResult {
    /** Deep-link URL the native auth session returned to (`?code=…&state=…`), or `null` if unobserved. */
    redirectUrl: string | null;
    /** The CSRF `state` sent on the authorize request; the RP must match it on return. */
    state: string;
    /** The PKCE `code_verifier` to replay on the token exchange. */
    codeVerifier: string;
}

/**
 * Persist the OAuth CSRF `state` + PKCE `code_verifier` for the RP callback.
 * Returns `false` when the handshake could not be stored — no `sessionStorage`
 * (SSR / non-browser host) or a write that threw (`SecurityError` /
 * `QuotaExceededError`, e.g. Safari private mode) — so the caller aborts the
 * flow cleanly rather than redirect to a callback that cannot validate `state`.
 */
function persistOAuthHandshake(state: string, codeVerifier: string): boolean {
    const store = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    try {
        if (!store) throw new Error('sessionStorage is unavailable');
        store.setItem(OXY_OAUTH_STATE_STORAGE_KEY, state);
        store.setItem(OXY_OAUTH_CODE_VERIFIER_STORAGE_KEY, codeVerifier);
        return true;
    } catch (error) {
        logger.warn(
            'OxySignInButton: could not persist the OAuth handshake to sessionStorage; aborting third-party sign-in',
            { component: 'OxySignInButton' },
            error,
        );
        return false;
    }
}

export interface OxySignInButtonProps {
    /**
     * Controls the appearance of the button
     * @default 'default'
     */
    variant?: 'default' | 'outline' | 'contained';

    /**
     * Optional function to handle button press
     * If not provided, the button will use the showBottomSheet method from OxyContext
     */
    onPress?: () => void;

    /**
     * Additional styles for the button container
     */
    style?: StyleProp<ViewStyle>;

    /**
     * Additional styles for the button text
     */
    textStyle?: StyleProp<TextStyle>;

    /**
     * Custom button text
     * @default 'Sign in with Oxy'
     */
    text?: string;

    /**
     * Whether to disable the button
     * @default false
     */
    disabled?: boolean;

    /**
     * Whether to show the button even if user is already authenticated
     * @default false
     */
    showWhenAuthenticated?: boolean;

    /**
     * Exact registered redirect URI the OAuth authorization code is returned to.
     * REQUIRED only for third-party (`type: 'third_party'`) applications, which
     * sign in via an OAuth + PKCE redirect to `auth.oxy.so`. First-party /
     * official apps open the in-app dialog and ignore this prop. If a third-party
     * app resolves without it, the button logs an error and does nothing (it will
     * not invent a redirect URI).
     */
    oauthRedirectUri?: string;

    /**
     * Native only: receives the OAuth handshake after a third-party auth session
     * so the RP can finish the token exchange. On web the handshake is read back
     * from `sessionStorage` across the full-page redirect, so this is not used
     * there. A native third-party sign-in with NO `onOAuthResult` handler cannot
     * complete (the `state` + `code_verifier` are lost) and logs a warning.
     *
     * @example
     * ```tsx
     * <OxySignInButton
     *   oauthRedirectUri="myapp://oauth/callback"
     *   onOAuthResult={({ redirectUrl, state, codeVerifier }) => {
     *     if (!redirectUrl) return;
     *     const code = new URL(redirectUrl).searchParams.get('code');
     *     // → POST /auth/oauth/token { code, code_verifier: codeVerifier, state }
     *   }}
     * />
     * ```
     */
    onOAuthResult?: (result: OxyOAuthResult) => void;
}

/**
 * A pre-styled button component for signing in with Oxy identity
 *
 * This component opens the Oxy Auth flow which allows users to authenticate
 * using their Oxy Accounts identity (via QR code or deep link).
 *
 * @example
 * ```tsx
 * // Basic usage
 * <OxySignInButton />
 *
 * // Custom styling
 * <OxySignInButton
 *   variant="contained"
 *   style={{ marginTop: 20 }}
 *   text="Login with Oxy"
 * />
 *
 * // Custom handler
 * <OxySignInButton onPress={() => {
 *   // Custom authentication flow
 * }} />
 * ```
 */
export const OxySignInButton: React.FC<OxySignInButtonProps> = ({
    variant = 'default',
    onPress,
    style,
    textStyle,
    text = 'Sign in with Oxy',
    disabled = false,
    showWhenAuthenticated = false,
    oauthRedirectUri,
    onOAuthResult,
}) => {
    const theme = useTheme();
    const { openAccountDialog, oxyServices, clientId } = useOxy();
    const { isAuthenticated, isLoading } = useAuthStore(
        useShallow((state) => ({ isAuthenticated: state.isAuthenticated, isLoading: state.isLoading }))
    );
    // Tracks whether the unified account dialog is open so we can show
    // "Signing in..." while it is. The manager reports visibility on every
    // change regardless of platform or what opened/closed it.
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => subscribeToSignInModal(setIsModalOpen), []);

    // The application's public identity is resolved lazily on first press and its
    // promise cached, so rapid taps share one in-flight resolve. The cache is
    // KEYED on the identity inputs (clientId + the oxyServices instance): if
    // either changes the cache is invalidated and re-resolved — without a
    // useEffect. A rejected resolve clears the cache so a later press can retry.
    const appResolutionRef = useRef<{
        clientId: string;
        oxyServices: typeof oxyServices;
        promise: Promise<PublicApplication>;
    } | null>(null);
    // Re-entrancy guard: a routing pass may await network + crypto before it
    // redirects, so block a second concurrent press from racing the sessionStorage
    // handshake against a different PKCE pair.
    const routingRef = useRef(false);

    const resolvePublicApplication = useCallback((): Promise<PublicApplication> | null => {
        if (!clientId) return null;
        const cached = appResolutionRef.current;
        if (cached && cached.clientId === clientId && cached.oxyServices === oxyServices) {
            return cached.promise;
        }
        const promise = oxyServices.getPublicApplication(clientId).catch((error) => {
            // Only clear if this is still the live entry (a later resolve may have
            // replaced it after a clientId/oxyServices change).
            if (appResolutionRef.current?.promise === promise) {
                appResolutionRef.current = null;
            }
            throw error;
        });
        appResolutionRef.current = { clientId, oxyServices, promise };
        return promise;
    }, [clientId, oxyServices]);

    // Official / first-party surface: the in-app account + sign-in dialog.
    const startOfficialSignIn = useCallback(() => {
        openAccountDialog('signin');
    }, [openAccountDialog]);

    // Third-party surface: an OAuth 2.0 authorization-code + PKCE redirect to
    // auth.oxy.so. No FedCM, no SSO bounce, no Oxy session cookies.
    const startThirdPartyOAuth = useCallback(
        async (app: PublicApplication): Promise<void> => {
            if (!clientId) {
                startOfficialSignIn();
                return;
            }
            if (!oauthRedirectUri) {
                logger.error(
                    'OxySignInButton: a third_party application requires the `oauthRedirectUri` prop to start the OAuth redirect; sign-in aborted',
                    undefined,
                    { component: 'OxySignInButton', clientId, application: app.name },
                );
                return;
            }

            const [pkce, state] = await Promise.all([generatePkcePair(), generateOAuthState()]);
            const authorizeUrl = buildOAuthAuthorizeUrl({
                clientId,
                redirectUri: oauthRedirectUri,
                state,
                codeChallenge: pkce.codeChallenge,
            });

            if (Platform.OS === 'web') {
                // Persist the handshake for the RP callback, then hand the
                // top-level document to the IdP. Without storage the callback
                // cannot validate `state`, so abort cleanly rather than redirect.
                if (!persistOAuthHandshake(state, pkce.codeVerifier)) {
                    return;
                }
                redirectToAuthorize(authorizeUrl);
                return;
            }

            // Native: open the in-app auth session, then hand the handshake to the
            // RP so it can complete the token exchange from its deep-link callback.
            const { redirectUrl } = await openAuthorizeUrlNative(authorizeUrl, oauthRedirectUri);
            if (onOAuthResult) {
                onOAuthResult({ redirectUrl, state, codeVerifier: pkce.codeVerifier });
                return;
            }
            logger.warn(
                'OxySignInButton: native third-party sign-in cannot complete without an `onOAuthResult` handler; the code exchange is the RP\'s responsibility (state + code_verifier were not surfaced)',
                { component: 'OxySignInButton', application: app.name },
            );
        },
        [clientId, oauthRedirectUri, onOAuthResult, startOfficialSignIn],
    );

    // Resolve the Application once, then route: third-party → OAuth redirect;
    // first-party / official / unresolved → the in-app dialog. Resolution failure
    // NEVER breaks an official app's sign-in — it falls back to the dialog.
    const routeSignIn = useCallback(async (): Promise<void> => {
        if (routingRef.current) return;
        routingRef.current = true;
        try {
            const resolving = resolvePublicApplication();
            if (!resolving) {
                startOfficialSignIn();
                return;
            }
            let app: PublicApplication;
            try {
                app = await resolving;
            } catch (error) {
                logger.warn(
                    'OxySignInButton: could not resolve the application; opening the sign-in dialog',
                    { component: 'OxySignInButton', clientId },
                    error,
                );
                startOfficialSignIn();
                return;
            }
            if (app.type === 'third_party' && !app.isOfficial) {
                await startThirdPartyOAuth(app);
                return;
            }
            startOfficialSignIn();
        } finally {
            routingRef.current = false;
        }
    }, [resolvePublicApplication, startOfficialSignIn, startThirdPartyOAuth, clientId]);

    // Defer to a caller-supplied handler, otherwise route by application type.
    const handlePress = useCallback(() => {
        if (onPress) {
            onPress();
            return;
        }
        void routeSignIn();
    }, [onPress, routeSignIn]);

    // Don't show the button if already authenticated (unless explicitly overridden)
    if (isAuthenticated && !showWhenAuthenticated) return null;

    const isButtonDisabled = disabled || isLoading || isModalOpen;

    // Map the public `variant` API onto Bloom's Button variants:
    //   contained → primary (filled), outline → outline, default → secondary.
    const buttonVariant: ButtonVariant =
        variant === 'contained' ? 'primary' : variant === 'outline' ? 'outline' : 'secondary';

    // The Oxy mark reads white-on-primary for the filled (contained) button and
    // primary-on-transparent for the outline / default surfaces.
    const isContained = variant === 'contained';
    const logoColor = isContained ? '#ffffff' : theme.colors.primary;
    const logoLetterColor = isContained ? theme.colors.primary : '#ffffff';

    return (
        <Button
            variant={buttonVariant}
            onPress={handlePress}
            disabled={isButtonDisabled}
            style={style}
            textStyle={[Platform.OS === 'web' ? { fontWeight: '600' } : null, textStyle]}
            icon={
                <LogoIcon
                    height={20}
                    color={logoColor}
                    letterColor={logoLetterColor}
                    style={{ marginRight: 10 }}
                />
            }
        >
            {isLoading || isModalOpen ? 'Signing in...' : text}
        </Button>
    );
};

export default OxySignInButton;
