/**
 * SignInModal - Web-first centered sign-in modal (first-party password sign-in)
 *
 * A semi-transparent full-screen modal whose PRIMARY action is the first-party
 * password flow (identifier → password → optional 2FA), driven by
 * `usePasswordSignIn`. Below an "or" divider, the cross-app device flow is a
 * SECONDARY option: a same-device "Sign in with the Oxy app" deep-link plus a
 * collapsed "Sign in on another device" QR disclosure (you can't scan your own
 * screen). The device-flow loading/error state only gates that secondary section
 * — the password form is always usable.
 *
 * The device-flow machinery (session-token creation, QR data, socket + polling,
 * waiting/error/retry state, same-device deep-link, deep-link return, and
 * cleanup) lives in the shared `useOxyAuthSession` hook, which the native
 * `OxyAuthScreen` also consumes — neither container re-implements the transport.
 *
 * Animates with a fade + scale effect.
 */

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@oxyhq/bloom/theme';
import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { Linking } from 'react-native';
import { useOxy } from '../context/OxyContext';
import OxyLogo from './OxyLogo';
import AnotherDeviceQR from './AnotherDeviceQR';
import { useOxyAuthSession, OXY_ACCOUNTS_WEB_URL } from '../hooks/useOxyAuthSession';
import { usePasswordSignIn } from '../hooks/usePasswordSignIn';

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

    const insets = useSafeAreaInsets();
    const theme = useTheme();
    const { oxyServices, handleWebSession, clientId } = useOxy();

    // Register the imperative visibility callback.
    useEffect(() => {
        setModalVisibleCallback = setVisible;
        return () => {
            setModalVisibleCallback = null;
        };
    }, []);

    if (!visible) return null;

    // The hook owns the whole auth-session lifecycle. Mounting it only while the
    // modal is visible matches the previous behavior (session created on open,
    // cleaned up on close) — the inner component is unmounted when `visible`
    // flips false, which runs the hook's unmount cleanup.
    return (
        <SignInModalContent
            theme={theme}
            insets={insets}
            oxyServices={oxyServices}
            handleWebSession={handleWebSession}
            clientId={clientId}
        />
    );
};

interface SignInModalContentProps {
    theme: ReturnType<typeof useTheme>;
    insets: ReturnType<typeof useSafeAreaInsets>;
    oxyServices: ReturnType<typeof useOxy>['oxyServices'];
    handleWebSession: ReturnType<typeof useOxy>['handleWebSession'];
    clientId: ReturnType<typeof useOxy>['clientId'];
}

const SignInModalContent: React.FC<SignInModalContentProps> = ({
    theme,
    insets,
    oxyServices,
    handleWebSession,
    clientId,
}) => {
    const { qrData, qrPayload, isLoading, error, isWaiting, openSameDeviceApproval, retry } = useOxyAuthSession(
        oxyServices,
        clientId,
        handleWebSession,
        { onSignedIn: hideSignInModal },
    );

    // First-party password sign-in — the PRIMARY action. Closes the modal on a
    // committed session; the device-first cold boot then drives the app into the
    // authenticated state.
    const pw = usePasswordSignIn({ onSignedIn: hideSignInModal });

    // Entrance animation.
    const opacity = useSharedValue(0);
    const scale = useSharedValue(0.96);

    // biome-ignore lint/correctness/useExhaustiveDependencies: opacity/scale are Reanimated SharedValues (stable refs) and must not be listed as deps; this runs once on mount to play the entrance.
    useEffect(() => {
        opacity.value = withTiming(1, { duration: 250 });
        scale.value = withTiming(1, { duration: 250 });
    }, []);

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    const contentStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ scale: scale.value }],
    }));

    const handleClose = useCallback(() => {
        hideSignInModal();
    }, []);

    const handleCreateAccount = useCallback(() => {
        Linking.openURL(OXY_ACCOUNTS_WEB_URL);
    }, []);

    return (
        <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={handleClose}>
            <Animated.View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }, backdropStyle]}>
                <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} activeOpacity={1} />

                <Animated.View
                    style={[
                        styles.card,
                        { backgroundColor: theme.colors.card, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
                        contentStyle,
                    ]}
                >
                    {/* Close button */}
                    <TouchableOpacity
                        style={[styles.closeButton, { backgroundColor: theme.colors.backgroundSecondary }]}
                        onPress={handleClose}
                        accessibilityRole="button"
                        accessibilityLabel="Close sign in"
                    >
                        <Text style={[styles.closeButtonText, { color: theme.colors.textSecondary }]}>×</Text>
                    </TouchableOpacity>

                    {/* Branded header */}
                    <View style={styles.header}>
                        <OxyLogo variant="icon" size={56} />
                        <Text className="text-foreground" style={styles.title}>Sign in to Oxy</Text>
                        <Text className="text-muted-foreground" style={styles.subtitle}>
                            Continue with your Oxy identity to sign in securely
                        </Text>
                    </View>

                    {/* PRIMARY action — first-party password sign-in. Always usable;
                        the device-flow loading/error state below never gates it. */}
                    <View style={styles.form}>
                        {pw.step === 'identifier' && (
                            <TextInput
                                style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.backgroundSecondary }]}
                                value={pw.identifier}
                                onChangeText={pw.setIdentifier}
                                onSubmitEditing={pw.submitIdentifier}
                                placeholder="Username or email"
                                placeholderTextColor={theme.colors.textSecondary}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="email-address"
                                returnKeyType="next"
                                accessibilityLabel="Username or email"
                            />
                        )}

                        {pw.step === 'password' && (
                            <>
                                <Text style={[styles.contextText, { color: theme.colors.textSecondary }]}>
                                    {pw.identifier}
                                </Text>
                                <TextInput
                                    style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.backgroundSecondary }]}
                                    value={pw.password}
                                    onChangeText={pw.setPassword}
                                    onSubmitEditing={pw.submitPassword}
                                    placeholder="Password"
                                    placeholderTextColor={theme.colors.textSecondary}
                                    secureTextEntry
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    returnKeyType="go"
                                    accessibilityLabel="Password"
                                />
                            </>
                        )}

                        {pw.step === 'twoFactor' && (
                            <TextInput
                                style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.backgroundSecondary }]}
                                value={pw.code}
                                onChangeText={pw.setCode}
                                onSubmitEditing={pw.submitTwoFactor}
                                placeholder={pw.useBackupCode ? 'Backup code' : '6-digit code'}
                                placeholderTextColor={theme.colors.textSecondary}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType={pw.useBackupCode ? 'default' : 'number-pad'}
                                returnKeyType="go"
                                accessibilityLabel={pw.useBackupCode ? 'Backup code' : 'Two-factor code'}
                            />
                        )}

                        {pw.step === 'identifier' && (
                            <Button
                                variant="primary"
                                onPress={pw.submitIdentifier}
                                loading={pw.isSubmitting}
                                disabled={pw.isSubmitting}
                                style={styles.primaryButton}
                            >
                                Continue
                            </Button>
                        )}

                        {pw.step === 'password' && (
                            <Button
                                variant="primary"
                                onPress={pw.submitPassword}
                                loading={pw.isSubmitting}
                                disabled={pw.isSubmitting}
                                style={styles.primaryButton}
                            >
                                Sign in
                            </Button>
                        )}

                        {pw.step === 'twoFactor' && (
                            <Button
                                variant="primary"
                                onPress={pw.submitTwoFactor}
                                loading={pw.isSubmitting}
                                disabled={pw.isSubmitting}
                                style={styles.primaryButton}
                            >
                                Verify
                            </Button>
                        )}

                        {pw.error && (
                            <Text className="text-destructive" style={styles.formError}>{pw.error}</Text>
                        )}

                        {pw.step === 'twoFactor' && (
                            <TouchableOpacity onPress={() => pw.setUseBackupCode(!pw.useBackupCode)} accessibilityRole="button" style={styles.linkButton}>
                                <Text style={[styles.linkText, { color: theme.colors.primary }]}>
                                    {pw.useBackupCode ? 'Use authenticator code' : 'Use a backup code'}
                                </Text>
                            </TouchableOpacity>
                        )}

                        {pw.step !== 'identifier' && (
                            <TouchableOpacity onPress={pw.back} accessibilityRole="button" style={styles.linkButton}>
                                <Text style={[styles.linkText, { color: theme.colors.textSecondary }]}>Back</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* "or" divider — separates the password form from the SECONDARY
                        cross-app device flow below. */}
                    <View style={styles.dividerRow}>
                        <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
                        <Text style={[styles.dividerText, { color: theme.colors.textSecondary }]}>or</Text>
                        <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
                    </View>

                    {/* SECONDARY — cross-app device flow. Its loading/error state gates
                        ONLY this section; the password form above is always usable. In the
                        device-first model these paths persist a durable session, so they
                        are always shown when a payload exists. */}
                    {isLoading ? (
                        <View style={styles.deviceLoading}>
                            <Loading size="small" style={styles.statusSpinner} />
                            <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>
                                Preparing sign in...
                            </Text>
                        </View>
                    ) : error ? (
                        <View style={styles.errorContainer}>
                            <Text className="text-destructive" style={styles.errorText}>{error}</Text>
                            <Button variant="secondary" onPress={retry} style={styles.secondaryButton}>Try Again</Button>
                        </View>
                    ) : (
                        <>
                            {/* Same-device "Sign in with Oxy" handoff — deep-links into the
                                native Oxy app to approve. Shown only when the handoff backend
                                returned a payload. */}
                            {qrPayload && (
                                <Button
                                    variant="secondary"
                                    onPress={openSameDeviceApproval}
                                    icon={<OxyLogo variant="icon" size={20} fillColor={theme.colors.text} style={styles.buttonIcon} />}
                                    style={styles.secondaryButton}
                                >
                                    Sign in with the Oxy app
                                </Button>
                            )}

                            {/* Waiting status */}
                            {isWaiting && (
                                <View style={styles.statusContainer}>
                                    <Loading size="small" style={styles.statusSpinner} />
                                    <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>
                                        Waiting for authorization...
                                    </Text>
                                </View>
                            )}

                            {/* Collapsed "sign in on another device" QR disclosure. */}
                            <View style={styles.qrSection}>
                                <AnotherDeviceQR qrData={qrData} qrPayload={qrPayload} />
                            </View>
                        </>
                    )}

                    {/* Footer — create an account */}
                    <View style={styles.footer}>
                        <Text style={styles.footerText} className="text-muted-foreground">
                            Don't have an Oxy account?{' '}
                        </Text>
                        <TouchableOpacity onPress={handleCreateAccount} accessibilityRole="link">
                            <Text style={styles.footerLink} className="text-primary">
                                Create one
                            </Text>
                        </TouchableOpacity>
                    </View>
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
    card: {
        width: '100%',
        maxWidth: 400,
        alignItems: 'center',
        paddingHorizontal: 24,
        borderRadius: 24,
    },
    closeButton: {
        position: 'absolute',
        top: 16,
        right: 16,
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    closeButtonText: {
        fontSize: 28,
        fontWeight: '300',
        lineHeight: 32,
    },
    header: {
        alignItems: 'center',
        marginBottom: 28,
    },
    title: {
        fontSize: 26,
        fontWeight: 'bold',
        marginTop: 16,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        marginTop: 8,
        textAlign: 'center',
    },
    primaryButton: {
        width: '100%',
        borderRadius: 12,
    },
    secondaryButton: {
        width: '100%',
        borderRadius: 12,
        marginTop: 12,
    },
    buttonIcon: {
        marginRight: 10,
    },
    form: {
        width: '100%',
    },
    input: {
        width: '100%',
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 15,
        marginBottom: 12,
    },
    contextText: {
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 12,
    },
    formError: {
        fontSize: 14,
        textAlign: 'center',
        marginTop: 12,
    },
    linkButton: {
        alignSelf: 'center',
        paddingVertical: 8,
        marginTop: 8,
    },
    linkText: {
        fontSize: 14,
        fontWeight: '600',
    },
    dividerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        marginVertical: 20,
    },
    dividerLine: {
        flex: 1,
        height: 1,
    },
    dividerText: {
        marginHorizontal: 12,
        fontSize: 13,
    },
    deviceLoading: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 20,
    },
    statusSpinner: {
        flex: undefined,
    },
    statusText: {
        marginLeft: 8,
        fontSize: 14,
    },
    qrSection: {
        width: '100%',
        marginTop: 24,
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
    footer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginTop: 28,
    },
    footerText: {
        fontSize: 14,
    },
    footerLink: {
        fontSize: 14,
        fontWeight: '600',
    },
});

export default SignInModal;
