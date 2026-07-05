/**
 * SignInModal — web-first centered sign-in modal.
 *
 * Two phases, Google-style:
 *  1. Account chooser (FRONT screen, shown when the device/user already has
 *     accounts): pick an account to continue as — one tap switches through the
 *     SAME `switchToAccount` path the account switcher uses — or "Use another
 *     account" to reveal the sign-in options.
 *  2. Sign-in options: the first-party password flow (identifier → password →
 *     optional 2FA, `usePasswordSignIn`) as the PRIMARY action, with the
 *     cross-app device flow (same-device deep-link + "sign in on another device"
 *     QR) as a SECONDARY option below an "or" divider.
 *
 * When there are no accounts the modal opens straight on the sign-in options.
 * The device-flow machinery lives in the shared `useOxyAuthSession` hook (the
 * native `OxyAuthScreen` consumes it too — neither container re-implements the
 * transport). Animates with a fade + scale; per-phase content cross-fades and
 * respects reduced motion.
 */

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Linking, AccessibilityInfo } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    FadeIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@oxyhq/bloom/theme';
import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { toast } from '@oxyhq/bloom';
import { Ionicons } from '@expo/vector-icons';
import { isDev, logger as loggerUtil } from '@oxyhq/core';
import { useOxy } from '../context/OxyContext';
import OxyLogo from './OxyLogo';
import AnotherDeviceQR from './AnotherDeviceQR';
import SignInAccountChooser from './SignInAccountChooser';
import { useSwitchableAccounts, type SwitchableAccount } from '../hooks/useSwitchableAccounts';
import { useI18n } from '../hooks/useI18n';
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

    // Register the imperative visibility callback.
    useEffect(() => {
        setModalVisibleCallback = setVisible;
        return () => {
            setModalVisibleCallback = null;
        };
    }, []);

    if (!visible) return null;

    // Mounting the content only while visible preserves the session-created-on-open
    // / cleaned-up-on-close behaviour and resets the phase state on every reopen.
    return <SignInModalContent theme={theme} insets={insets} />;
};

interface SignInModalContentProps {
    theme: ReturnType<typeof useTheme>;
    insets: ReturnType<typeof useSafeAreaInsets>;
}

const SignInModalContent: React.FC<SignInModalContentProps> = ({ theme, insets }) => {
    const { oxyServices, handleWebSession, clientId, switchToAccount } = useOxy();
    const { t } = useI18n();
    const { accounts } = useSwitchableAccounts();

    // Phase: the chooser is the front screen whenever accounts exist AND the user
    // has not tapped "Use another account" this session.
    const [useAnother, setUseAnother] = useState(false);
    const [switchingId, setSwitchingId] = useState<string | null>(null);
    const showChooser = !useAnother && accounts.length > 0;

    const { qrData, qrPayload, isLoading, error, isWaiting, openSameDeviceApproval, retry } = useOxyAuthSession(
        oxyServices,
        clientId,
        handleWebSession,
        { onSignedIn: hideSignInModal },
    );

    // First-party password sign-in — the PRIMARY option once past the chooser.
    const pw = usePasswordSignIn({ onSignedIn: hideSignInModal });

    // Entrance animation (respects reduced motion).
    const opacity = useSharedValue(0);
    const scale = useSharedValue(0.96);
    // biome-ignore lint/correctness/useExhaustiveDependencies: opacity/scale are Reanimated SharedValues (stable refs), not deps; runs once on mount.
    useEffect(() => {
        let cancelled = false;
        AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
            if (cancelled) return;
            const duration = reduced ? 0 : 250;
            opacity.value = withTiming(1, { duration });
            scale.value = withTiming(1, { duration });
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
    const contentStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ scale: scale.value }],
    }));

    const handleClose = useCallback(() => hideSignInModal(), []);
    const handleCreateAccount = useCallback(() => Linking.openURL(OXY_ACCOUNTS_WEB_URL), []);

    const handleSelectAccount = useCallback(async (account: SwitchableAccount) => {
        // The active account is already signed in — selecting it just continues.
        if (account.isCurrent) {
            hideSignInModal();
            return;
        }
        if (switchingId) return;
        setSwitchingId(account.accountId);
        try {
            await switchToAccount(account.accountId);
            hideSignInModal();
        } catch (switchError) {
            if (isDev()) {
                loggerUtil.warn('SignInModal: switch account failed', { component: 'SignInModal' }, switchError as unknown);
            }
            toast.error(t('accountSwitcher.toasts.switchFailed') || 'Failed to switch account');
        } finally {
            setSwitchingId(null);
        }
    }, [switchingId, switchToAccount, t]);

    const title = showChooser ? t('signin.chooser.title') : 'Sign in to Oxy';
    const subtitle = showChooser
        ? t('signin.chooser.subtitle')
        : 'Continue with your Oxy identity to sign in securely.';

    return (
        <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={handleClose}>
            <Animated.View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }, backdropStyle]}>
                <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} activeOpacity={1} />

                <Animated.View
                    style={[
                        styles.card,
                        { backgroundColor: theme.colors.card, paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 },
                        contentStyle,
                    ]}
                >
                    <TouchableOpacity
                        style={[styles.closeButton, { backgroundColor: theme.colors.backgroundSecondary }]}
                        onPress={handleClose}
                        accessibilityRole="button"
                        accessibilityLabel="Close sign in"
                    >
                        <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                    </TouchableOpacity>

                    {/* Branded header */}
                    <View style={styles.header}>
                        <OxyLogo variant="icon" size={52} />
                        <Text className="text-foreground" style={styles.title}>{title}</Text>
                        <Text className="text-muted-foreground" style={styles.subtitle}>{subtitle}</Text>
                    </View>

                    {showChooser ? (
                        <Animated.View key="chooser" entering={FadeIn.duration(180)} style={styles.phase}>
                            <SignInAccountChooser
                                accounts={accounts}
                                onSelectAccount={handleSelectAccount}
                                onUseAnother={() => setUseAnother(true)}
                                pendingAccountId={switchingId}
                                disabled={switchingId !== null}
                            />
                        </Animated.View>
                    ) : (
                        <Animated.View key="signIn" entering={FadeIn.duration(180)} style={styles.phase}>
                            {/* Back to the chooser when accounts exist. */}
                            {accounts.length > 0 && (
                                <TouchableOpacity
                                    onPress={() => setUseAnother(false)}
                                    accessibilityRole="button"
                                    style={styles.backRow}
                                >
                                    <Ionicons name="chevron-back" size={18} color={theme.colors.textSecondary} />
                                    <Text style={[styles.backText, { color: theme.colors.textSecondary }]}>{t('signin.chooser.title')}</Text>
                                </TouchableOpacity>
                            )}

                            {/* PRIMARY — first-party password sign-in. Always usable; the
                                device-flow loading/error state below never gates it. */}
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
                                        <Text style={[styles.contextText, { color: theme.colors.textSecondary }]}>{pw.identifier}</Text>
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

                                <Button
                                    variant="primary"
                                    onPress={
                                        pw.step === 'identifier' ? pw.submitIdentifier
                                            : pw.step === 'password' ? pw.submitPassword
                                                : pw.submitTwoFactor
                                    }
                                    loading={pw.isSubmitting}
                                    disabled={pw.isSubmitting}
                                    style={styles.primaryButton}
                                >
                                    {pw.step === 'identifier' ? 'Continue' : pw.step === 'password' ? 'Sign in' : 'Verify'}
                                </Button>

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

                            {/* "or" divider */}
                            <View style={styles.dividerRow}>
                                <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
                                <Text style={[styles.dividerText, { color: theme.colors.textSecondary }]}>or</Text>
                                <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
                            </View>

                            {/* SECONDARY — cross-app device flow. Its loading/error state gates
                                ONLY this section; the password form above is always usable. */}
                            {isLoading ? (
                                <View style={styles.deviceLoading}>
                                    <Loading size="small" style={styles.statusSpinner} />
                                    <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>Preparing sign in…</Text>
                                </View>
                            ) : error ? (
                                <View style={styles.errorContainer}>
                                    <Text className="text-destructive" style={styles.errorText}>{error}</Text>
                                    <Button variant="secondary" onPress={retry} style={styles.secondaryButton}>Try Again</Button>
                                </View>
                            ) : (
                                <>
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

                                    {isWaiting && (
                                        <View style={styles.statusContainer}>
                                            <Loading size="small" style={styles.statusSpinner} />
                                            <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>Waiting for authorization…</Text>
                                        </View>
                                    )}

                                    <View style={styles.qrSection}>
                                        <AnotherDeviceQR qrData={qrData} qrPayload={qrPayload} />
                                    </View>
                                </>
                            )}
                        </Animated.View>
                    )}

                    {/* Footer — create an account */}
                    <View style={styles.footer}>
                        <Text style={styles.footerText} className="text-muted-foreground">
                            Don't have an Oxy account?{' '}
                        </Text>
                        <TouchableOpacity onPress={handleCreateAccount} accessibilityRole="link">
                            <Text style={styles.footerLink} className="text-primary">Create one</Text>
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
        maxWidth: 420,
        alignItems: 'center',
        paddingHorizontal: 24,
        borderRadius: 28,
    },
    closeButton: {
        position: 'absolute',
        top: 16,
        right: 16,
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    header: {
        alignItems: 'center',
        marginBottom: 24,
    },
    title: {
        fontSize: 26,
        fontWeight: '800',
        letterSpacing: -0.5,
        marginTop: 16,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        lineHeight: 21,
        marginTop: 8,
        textAlign: 'center',
    },
    phase: {
        width: '100%',
    },
    backRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        paddingVertical: 6,
        marginBottom: 8,
    },
    backText: {
        fontSize: 14,
        fontWeight: '600',
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
        paddingVertical: 13,
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
