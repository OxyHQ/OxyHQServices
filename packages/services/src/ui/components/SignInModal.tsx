/**
 * SignInModal - Full screen sign-in modal with QR code
 *
 * A semi-transparent full-screen modal that displays:
 * - QR code for scanning with Oxy Accounts app
 * - Button to open Oxy Auth popup
 *
 * Animates with fade-in effect.
 */

import type React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Dimensions,
    Platform,
    Linking,
    useWindowDimensions,
} from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import io, { type Socket } from 'socket.io-client';
import QRCode from 'react-native-qrcode-svg';
import { useTheme } from '@oxyhq/bloom/theme';
import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { BottomSheet, type BottomSheetRef } from '@oxyhq/bloom/bottom-sheet';
import { useOxy } from '../context/OxyContext';
import OxyLogo from './OxyLogo';
import { createDebugLogger } from '@oxyhq/core';

const debug = createDebugLogger('SignInModal');

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Auth session expiration (5 minutes)
const AUTH_SESSION_EXPIRY_MS = 5 * 60 * 1000;

// Polling interval (fallback if socket fails)
const POLLING_INTERVAL_MS = 3000;

interface AuthSession {
    sessionToken: string;
    expiresAt: number;
}

interface AuthUpdatePayload {
    status: 'authorized' | 'cancelled' | 'expired';
    sessionId?: string;
    publicKey?: string;
    userId?: string;
    username?: string;
}

// Store for modal visibility with subscription support
let modalVisible = false;
let setModalVisibleCallback: ((visible: boolean) => void) | null = null;
const visibilityListeners = new Set<(visible: boolean) => void>();

export const showSignInModal = () => {
    modalVisible = true;
    setModalVisibleCallback?.(true);
    for (const listener of visibilityListeners) listener(true);
};

export const hideSignInModal = () => {
    modalVisible = false;
    setModalVisibleCallback?.(false);
    for (const listener of visibilityListeners) listener(false);
};

export const isSignInModalVisible = () => modalVisible;

/** Subscribe to modal visibility changes */
export const subscribeToSignInModal = (listener: (visible: boolean) => void): (() => void) => {
    visibilityListeners.add(listener);
    return () => visibilityListeners.delete(listener);
};

type ModalView = 'main' | 'qr';

const SignInModal: React.FC = () => {
    const [visible, setVisible] = useState(false);
    const [view, setView] = useState<ModalView>('main');
    const [authSession, setAuthSession] = useState<AuthSession | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isWaiting, setIsWaiting] = useState(false);

    const insets = useSafeAreaInsets();
    const theme = useTheme();
    const { width: windowWidth } = useWindowDimensions();
    const isWide = windowWidth >= 768;
    const { oxyServices, switchSession } = useOxy();

    const socketRef = useRef<Socket | null>(null);
    const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isProcessingRef = useRef(false);
    const sheetRef = useRef<BottomSheetRef>(null);

    // Animation values
    const opacity = useSharedValue(0);
    const scale = useSharedValue(0.9);

    // Register callback
    useEffect(() => {
        setModalVisibleCallback = setVisible;
        return () => {
            setModalVisibleCallback = null;
        };
    }, []);

    // Animate in/out
    // biome-ignore lint/correctness/useExhaustiveDependencies: opacity and scale are Reanimated SharedValues (stable refs) that should not be listed as dependencies
    useEffect(() => {
        if (visible) {
            opacity.value = withTiming(1, { duration: 250 });
            scale.value = withTiming(1, { duration: 250 });
            setView('main');
            generateAuthSession();
            if (!isWide) sheetRef.current?.present();
        } else {
            opacity.value = withTiming(0, { duration: 200 });
            scale.value = withTiming(0.9, { duration: 200 });
            if (!isWide) sheetRef.current?.dismiss();
        }
    }, [visible, isWide]);

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    const contentStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ scale: scale.value }],
    }));

    // Handle successful authorization
    const handleAuthSuccess = useCallback(async (sessionId: string) => {
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;

        // Dismiss the in-app browser (if any) so the user returns to the app.
        if (Platform.OS !== 'web') {
            try {
                const WebBrowser = await import('expo-web-browser');
                WebBrowser.dismissBrowser();
            } catch {
                /* expo-web-browser not available */
            }
        }

        try {
            if (switchSession) {
                await switchSession(sessionId);
            } else {
                await oxyServices.getTokenBySession(sessionId);
            }
            hideSignInModal();
        } catch (err) {
            debug.error('Error completing auth:', err);
            setError('Authorization successful but failed to complete sign in. Please try again.');
            isProcessingRef.current = false;
        }
    }, [oxyServices, switchSession]);

    // Cleanup socket and polling
    const cleanup = useCallback(() => {
        setIsWaiting(false);

        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
        }

        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
    }, []);

    // Connect to socket for real-time updates
    const connectSocket = useCallback((sessionToken: string) => {
        // Disconnect any pre-existing socket to avoid duplicates on re-renders.
        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
        }
        const baseURL = oxyServices.getBaseURL();

        const socket = io(`${baseURL}/auth-session`, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 3,
            reconnectionDelay: 1000,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            debug.log('Auth socket connected, joining room with token:', sessionToken.substring(0, 8) + '...');
            socket.emit('join', sessionToken);
        });

        socket.on('joined', (payload: unknown) => {
            debug.log('Joined room:', payload);
        });

        socket.on('disconnect', (reason: string) => {
            debug.log('Auth socket disconnected:', reason);
        });

        socket.on('auth_update', (payload: AuthUpdatePayload) => {
            debug.log('Auth update received:', payload);

            if (payload.status === 'authorized' && payload.sessionId) {
                cleanup();
                handleAuthSuccess(payload.sessionId);
            } else if (payload.status === 'cancelled') {
                cleanup();
                setError('Authorization was denied.');
            } else if (payload.status === 'expired') {
                cleanup();
                setError('Session expired. Please try again.');
            }
        });

        socket.on('connect_error', (err) => {
            debug.log('Socket connection error, falling back to polling:', (err instanceof Error ? err.message : null));
            socket.disconnect();
            startPolling(sessionToken);
        });
    }, [oxyServices, handleAuthSuccess, cleanup]);

    // Start polling for authorization (fallback)
    const startPolling = useCallback((sessionToken: string) => {
        pollingIntervalRef.current = setInterval(async () => {
            if (isProcessingRef.current) return;

            try {
                const response: {
                    authorized: boolean;
                    sessionId?: string;
                    status?: string;
                } = await oxyServices.makeRequest('GET', `/auth/session/status/${sessionToken}`, undefined, { cache: false });

                if (response.authorized && response.sessionId) {
                    cleanup();
                    handleAuthSuccess(response.sessionId);
                } else if (response.status === 'cancelled') {
                    cleanup();
                    setError('Authorization was denied.');
                } else if (response.status === 'expired') {
                    cleanup();
                    setError('Session expired. Please try again.');
                }
            } catch (err) {
                debug.log('Auth polling error:', err);
            }
        }, POLLING_INTERVAL_MS);
    }, [oxyServices, handleAuthSuccess, cleanup]);

    // Generate a new auth session
    const generateAuthSession = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        isProcessingRef.current = false;

        try {
            const sessionToken = generateSessionToken();
            const expiresAt = Date.now() + AUTH_SESSION_EXPIRY_MS;

            await oxyServices.makeRequest('POST', '/auth/session/create', {
                sessionToken,
                expiresAt,
                appId: Platform.OS,
            }, { cache: false });

            setAuthSession({ sessionToken, expiresAt });
            setIsWaiting(true);
            connectSocket(sessionToken);
        } catch (err: unknown) {
            setError((err instanceof Error ? err.message : null) || 'Failed to create auth session');
        } finally {
            setIsLoading(false);
        }
    }, [oxyServices, connectSocket]);

    // Generate a random session token
    const generateSessionToken = (): string => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 32; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };

    // Build the QR code data
    const getQRData = (): string => {
        if (!authSession) return '';
        return `oxyauth://${authSession.sessionToken}`;
    };

    // Open Oxy Auth popup
    const handleOpenAuthPopup = useCallback(async () => {
        if (!authSession) return;

        const baseURL = oxyServices.getBaseURL();
        // Resolve auth web URL
        let authWebUrl = oxyServices.config?.authWebUrl;
        if (!authWebUrl) {
            try {
                const url = new URL(baseURL);
                if (url.port === '3001') {
                    url.port = '3002';
                    authWebUrl = url.origin;
                } else if (url.hostname.startsWith('api.')) {
                    url.hostname = `auth.${url.hostname.slice(4)}`;
                    authWebUrl = url.origin;
                }
            } catch {
                authWebUrl = 'https://auth.oxy.so';
            }
        }
        authWebUrl = authWebUrl || 'https://auth.oxy.so';

        const webUrl = new URL('/authorize', authWebUrl);
        webUrl.searchParams.set('token', authSession.sessionToken);

        if (Platform.OS === 'web') {
            // Open popup window on web
            const width = 500;
            const height = 650;
            const screenWidth = window.screen?.width ?? width;
            const screenHeight = window.screen?.height ?? height;
            const left = (screenWidth - width) / 2;
            const top = (screenHeight - height) / 2;

            window.open(
                webUrl.toString(),
                'oxy-auth-popup',
                `width=${width},height=${height},left=${left},top=${top},popup=1`
            );
        } else {
            // Open in in-app browser on native via expo-web-browser. Falls back
            // to system browser if expo-web-browser is not available.
            try {
                const WebBrowser = await import('expo-web-browser');
                // Belt-and-suspenders: also start HTTP polling while the browser is
                // open. The websocket can drop while the app is backgrounded; polling
                // ensures we still see the authorized state on return.
                if (!pollingIntervalRef.current && authSession) {
                    startPolling(authSession.sessionToken);
                }
                await WebBrowser.openBrowserAsync(webUrl.toString(), {
                    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
                    dismissButtonStyle: 'close',
                });
            } catch {
                Linking.openURL(webUrl.toString());
            }
        }
    }, [authSession, oxyServices, startPolling]);

    // Refresh session
    const handleRefresh = useCallback(() => {
        cleanup();
        generateAuthSession();
    }, [generateAuthSession, cleanup]);

    // Handle close
    const handleClose = useCallback(() => {
        cleanup();
        hideSignInModal();
    }, [cleanup]);

    // Clean up on unmount
    useEffect(() => {
        return () => {
            cleanup();
        };
    }, [cleanup]);

    if (!visible && isWide) return null;

    const innerContent = (
        <>
            {!isWide && view === 'qr' ? (
                <TouchableOpacity style={styles.backButton} onPress={() => setView('main')} accessibilityLabel="Back">
                    <Text style={styles.backButtonText}>‹</Text>
                </TouchableOpacity>
            ) : null}
            {isWide ? (
                <TouchableOpacity style={styles.closeButton} onPress={handleClose} accessibilityLabel="Close">
                    <Text style={styles.closeButtonText}>×</Text>
                </TouchableOpacity>
            ) : null}

            {isLoading ? (
                        <View style={styles.loadingContainer}>
                            <OxyLogo variant="icon" size={56} />
                            <Loading size="large" />
                            <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                                Preparing sign in...
                            </Text>
                        </View>
                    ) : error ? (
                        <View style={styles.errorContainer}>
                            <OxyLogo variant="icon" size={56} />
                            <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
                            <Button onPress={handleRefresh}>Try Again</Button>
                        </View>
                    ) : isWide ? (
                        <>
                            <View style={styles.header}>
                                <OxyLogo variant="icon" size={56} />
                                <Text style={[styles.title, { color: theme.colors.text }]}>Sign in with Oxy</Text>
                                <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                                    Scan with Oxy Accounts app or use the button below
                                </Text>
                            </View>

                            <View style={[styles.qrContainer, { backgroundColor: 'white' }]}>
                                {authSession ? (
                                    <QRCode
                                        value={getQRData()}
                                        size={200}
                                        backgroundColor="white"
                                        color="black"
                                    />
                                ) : (
                                    <Loading size="large" />
                                )}
                            </View>

                            <View style={styles.dividerContainer}>
                                <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
                                <Text style={[styles.dividerText, { color: theme.colors.textTertiary }]}>or</Text>
                                <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
                            </View>

                            <Button
                                onPress={handleOpenAuthPopup}
                                icon={<OxyLogo variant="icon" size={20} fillColor={theme.colors.card} />}
                            >
                                Open Oxy Auth
                            </Button>

                            {isWaiting && (
                                <View style={styles.statusContainer}>
                                    <Loading size="small" />
                                    <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>
                                        Waiting for authorization…
                                    </Text>
                                </View>
                            )}
                        </>
                    ) : view === 'main' ? (
                        <>
                            <View style={styles.header}>
                                <OxyLogo variant="icon" size={56} />
                                <Text style={[styles.title, { color: theme.colors.text }]}>Sign in with Oxy</Text>
                                <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                                    One account for the whole Oxy ecosystem. Continue to authorize this device.
                                </Text>
                            </View>

                            <View style={styles.actions}>
                                <Button
                                    onPress={handleOpenAuthPopup}
                                    icon={<OxyLogo variant="icon" size={20} fillColor={theme.colors.card} />}
                                >
                                    Continue with Oxy
                                </Button>

                                <Button variant="ghost" onPress={() => setView('qr')}>
                                    Scan QR code instead
                                </Button>
                            </View>
                        </>
                    ) : (
                        <>
                            <View style={styles.header}>
                                <Text style={[styles.title, { color: theme.colors.text }]}>Scan QR</Text>
                                <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                                    Open the Oxy Accounts app on another device and scan this code.
                                </Text>
                            </View>

                            <View style={[styles.qrContainer, { backgroundColor: 'white' }]}>
                                {authSession ? (
                                    <QRCode
                                        value={getQRData()}
                                        size={220}
                                        backgroundColor="white"
                                        color="black"
                                    />
                                ) : (
                                    <Loading size="large" />
                                )}
                            </View>

                            {isWaiting && (
                                <View style={styles.statusContainer}>
                                    <Loading size="small" />
                                    <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>
                                        Waiting for authorization…
                                    </Text>
                                </View>
                            )}
                        </>
                    )}
        </>
    );

    if (!isWide) {
        return (
            <BottomSheet
                ref={sheetRef}
                onDismiss={handleClose}
                enablePanDownToClose
            >
                <View style={[styles.sheetContent, { paddingBottom: insets.bottom + 24 }]}>
                    {innerContent}
                </View>
            </BottomSheet>
        );
    }

    return (
        <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={handleClose}>
            <Animated.View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }, backdropStyle]}>
                <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} activeOpacity={1} />

                <Animated.View style={[styles.content, contentStyle, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
                    {innerContent}
                </Animated.View>
            </Animated.View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        width: '100%',
        maxWidth: 400,
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    closeButton: {
        position: 'absolute',
        top: 16,
        right: 16,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    closeButtonText: {
        color: 'white',
        fontSize: 28,
        fontWeight: '300',
        lineHeight: 32,
    },
    backButton: {
        position: 'absolute',
        top: 16,
        left: 16,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    backButtonText: {
        color: 'white',
        fontSize: 32,
        fontWeight: '300',
        lineHeight: 32,
        marginRight: 2,
    },
    actions: {
        width: '100%',
        gap: 12,
    },
    sheetContent: {
        paddingHorizontal: 24,
        paddingTop: 48,
        paddingBottom: 32,
        alignItems: 'center',
        gap: 24,
        width: '100%',
    },
    header: {
        alignItems: 'center',
        gap: 8,
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        marginTop: 8,
    },
    subtitle: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
        maxWidth: 320,
    },
    qrContainer: {
        padding: 20,
        borderRadius: 16,
    },
    dividerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 24,
        width: '100%',
    },
    divider: {
        flex: 1,
        height: 1,
    },
    dividerText: {
        marginHorizontal: 16,
        fontSize: 14,
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 24,
    },
    statusText: {
        marginLeft: 8,
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.7)',
    },
    loadingContainer: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 14,
    },
    errorContainer: {
        alignItems: 'center',
        paddingVertical: 20,
        width: '100%',
    },
    errorText: {
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 16,
    },
});

export default SignInModal;
