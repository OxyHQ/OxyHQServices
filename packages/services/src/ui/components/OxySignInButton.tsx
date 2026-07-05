import type React from 'react';
import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { TouchableOpacity, Text, View, StyleSheet, type ViewStyle, type TextStyle, type StyleProp, Platform } from 'react-native';
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
import { useOxy } from '../context/OxyContext';
import OxyLogo from './OxyLogo';
import { subscribeToSignInModal } from '../navigation/accountDialogManager';
import { redirectToAuthorize, openAuthorizeUrlNative } from './oauthNavigation';

const isWeb = Platform.OS === 'web';

/**
 * `sessionStorage` keys under which a third-party "Sign in with Oxy" OAuth flow
 * persists its CSRF `state` and PKCE `code_verifier` across the authorize
 * redirect. The Relying Party's redirect-URI callback reads them back to
 * validate the returned `state` and replay the verifier on the token exchange.
 *
 * Web only: a browser RP navigates away to `auth.oxy.so` and back, so the
 * handshake must survive a full-page redirect. Native completes the flow inside
 * a single `WebBrowser` auth session and has no cross-navigation gap to bridge.
 */
export const OXY_OAUTH_STATE_STORAGE_KEY = 'oxy_oauth_state';
export const OXY_OAUTH_CODE_VERIFIER_STORAGE_KEY = 'oxy_oauth_code_verifier';

/**
 * Persist the OAuth CSRF `state` + PKCE `code_verifier` for the RP callback.
 * No-op where `sessionStorage` is unavailable (SSR / non-browser hosts).
 */
function persistOAuthHandshake(state: string, codeVerifier: string): void {
    const store = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (!store) return;
    store.setItem(OXY_OAUTH_STATE_STORAGE_KEY, state);
    store.setItem(OXY_OAUTH_CODE_VERIFIER_STORAGE_KEY, codeVerifier);
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

    // The application's public identity is resolved ONCE per mounted button and
    // its promise cached here, so the click handler stays lazy (no fetch until
    // first press) and rapid taps share one in-flight resolve. A rejected resolve
    // clears the cache so a later press can retry a transient failure.
    const appResolutionRef = useRef<Promise<PublicApplication> | null>(null);
    // Re-entrancy guard: a routing pass may await network + crypto before it
    // redirects, so block a second concurrent press from racing the sessionStorage
    // handshake against a different PKCE pair.
    const routingRef = useRef(false);

    const resolvePublicApplication = useCallback((): Promise<PublicApplication> | null => {
        if (!clientId) return null;
        if (!appResolutionRef.current) {
            appResolutionRef.current = oxyServices.getPublicApplication(clientId).catch((error) => {
                appResolutionRef.current = null;
                throw error;
            });
        }
        return appResolutionRef.current;
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

            if (isWeb) {
                // Persist the handshake for the RP callback, then hand the
                // top-level document to the IdP.
                persistOAuthHandshake(state, pkce.codeVerifier);
                redirectToAuthorize(authorizeUrl);
                return;
            }

            await openAuthorizeUrlNative(authorizeUrl, oauthRedirectUri);
        },
        [clientId, oauthRedirectUri, startOfficialSignIn],
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

    const themedStyles = useMemo(() => StyleSheet.create({
        button: {
            padding: 14,
            borderRadius: 35,
            alignItems: 'center',
            justifyContent: 'center',
        },
        buttonDefault: {
            backgroundColor: theme.colors.card,
            borderWidth: 1,
            borderColor: theme.colors.borderLight,
            ...Platform.select({
                web: {
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                },
                default: {
                    shadowColor: '#000000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.1,
                    shadowRadius: 4,
                    elevation: 2,
                }
            }),
        },
        buttonOutline: {
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderColor: theme.colors.primary,
        },
        buttonContained: {
            backgroundColor: theme.colors.primary,
        },
        buttonDisabled: {
            opacity: 0.6,
        },
        buttonContent: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
        },
        text: {
            // Bloom's BloomThemeProvider sets the default font via Text.defaultProps,
            // so we intentionally do NOT set fontFamily here. Setting it would defeat
            // the theme-wide font.
            fontWeight: Platform.OS === 'web' ? '600' : undefined,
            fontSize: 16,
            marginLeft: 10,
        },
        textDefault: {
            color: theme.colors.text,
        },
        textOutline: {
            color: theme.colors.primary,
        },
        textContained: {
            color: '#FFFFFF',
        },
        textDisabled: {
            color: theme.colors.textTertiary,
        },
    }), [theme]);

    // Don't show the button if already authenticated (unless explicitly overridden)
    if (isAuthenticated && !showWhenAuthenticated) return null;

    const isButtonDisabled = disabled || isLoading || isModalOpen;

    // Determine the button style based on the variant
    const getButtonStyle = () => {
        switch (variant) {
            case 'outline':
                return [themedStyles.buttonOutline, style];
            case 'contained':
                return [themedStyles.buttonContained, style];
            default:
                return [themedStyles.buttonDefault, style];
        }
    };

    // Determine the text style based on the variant
    const getTextStyle = () => {
        switch (variant) {
            case 'outline':
                return [themedStyles.textOutline, textStyle];
            case 'contained':
                return [themedStyles.textContained, textStyle];
            default:
                return [themedStyles.textDefault, textStyle];
        }
    };

    return (
        <TouchableOpacity
            style={[themedStyles.button, getButtonStyle(), isButtonDisabled && themedStyles.buttonDisabled]}
            onPress={handlePress}
            disabled={isButtonDisabled}
        >
            <View style={themedStyles.buttonContent}>
                <OxyLogo
                    variant="icon"
                    size={20}
                    fillColor={variant === 'contained' ? 'white' : theme.colors.primary}
                    innerFillColor={variant === 'contained' ? theme.colors.primary : undefined}
                    style={isButtonDisabled ? { opacity: 0.6 } : undefined}
                />
                <Text style={[themedStyles.text, getTextStyle(), isButtonDisabled && themedStyles.textDisabled]}>
                    {isLoading || isModalOpen ? 'Signing in...' : text}
                </Text>
            </View>
        </TouchableOpacity>
    );
};

export default OxySignInButton;
