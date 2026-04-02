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

const SignInModal: React.FC = () => {
    const [visible, setVisible] = useState(false);
    const [authSession, setAuthSession] = useState<AuthSession | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isWaiting, setIsWaiting] = useState(false);

    const insets = useSafeAreaInsets();
    const theme = useTheme();
    const { oxyServices, switchSession } = useOxy();

    const socketRef = useRef<Socket | null>(null);
    const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isProcessingRef = useRef(false);

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
            generateAuthSession();
        } else {
            opacity.value = withTiming(0, { duration: 200 });
            scale.value = withTiming(0.9, { duration: 200 });
        }
    }, [visible]);

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
        const baseURL = oxyServices.getBaseURL();

        const socket = io(`${baseURL}/auth-session`, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 3,
            reconnectionDelay: 1000,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            debug.log('Auth socket connected');
            socket.emit('join', sessionToken);
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
                    url.port = '3000';
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
            // Open in browser on native
            Linking.openURL(webUrl.toString());
        }
    }, [authSession, oxyServices]);

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

    if (!visible) return null;

    return (
        <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={handleClose}>
            <Animated.View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }, backdropStyle]}>
                <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} activeOpacity={1} />

                <Animated.View style={[styles.content, contentStyle, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
                    {/* Close button */}
                    <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
                        <Text style={styles.closeButtonText}>×</Text>
                    </TouchableOpacity>

                    {/* Header */}
                    <View style={styles.header}>
                        <OxyLogo width={56} height={56} />
                        <Text style={[styles.title, { color: theme.colors.text }]}>Sign in with Oxy</Text>
                        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                            Scan with Oxy Accounts app or use the button below
                        </Text>
                    </View>

                    {isLoading ? (
                        <View style={styles.loadingContainer}>
                            <Loading size="large" />
                            <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                                Preparing sign in...
                            </Text>
                        </View>
                    ) : error ? (
                        <View style={styles.errorContainer}>
                            <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
                            <Button onPress={handleRefresh}>Try Again</Button>
                        </View>
                    ) : (
                        <>
                            {/* QR Code */}
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

                            {/* Divider */}
                            <View style={styles.dividerContainer}>
                                <View style={[styles.divider, { backgroundColor: 'rgba(255,255,255,0.3)' }]} />
                                <Text style={[styles.dividerText, { color: 'rgba(255,255,255,0.7)' }]}>or</Text>
                                <View style={[styles.divider, { backgroundColor: 'rgba(255,255,255,0.3)' }]} />
                            </View>

                            {/* Open Auth Popup Button */}
                            <Button
                                onPress={handleOpenAuthPopup}
                                icon={<OxyLogo width={20} height={20} fillColor={theme.colors.card} />}
                            >
                                Open Oxy Auth
                            </Button>

                            {/* Status */}
                            {isWaiting && (
                                <View style={styles.statusContainer}>
                                    <Loading size="small" />
                                    <Text style={styles.statusText}>
                                        Waiting for authorization...
                                    </Text>
                                </View>
                            )}
                        </>
                    )}
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
    header: {
        alignItems: 'center',
        marginBottom: 32,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        marginTop: 16,
        color: 'white',
    },
    subtitle: {
        fontSize: 15,
        marginTop: 8,
        textAlign: 'center',
        color: 'rgba(255, 255, 255, 0.7)',
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
