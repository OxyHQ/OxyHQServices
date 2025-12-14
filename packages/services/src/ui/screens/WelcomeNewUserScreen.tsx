import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Animated } from 'react-native';
import AnimatedReanimated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import type { BaseScreenProps } from '../types/navigation';
import Avatar from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { useAuthStore } from '../stores/authStore';
import { useThemeColors } from '../styles';
import { normalizeTheme } from '../utils/themeUtils';
import GroupedPillButtons from '../components/internal/GroupedPillButtons';
import { useI18n } from '../hooks/useI18n';
import { useOxy } from '../context/OxyContext';

const GAP = 12;
const INNER_GAP = 8;

// Individual animated progress dot
const AnimatedProgressDot: React.FC<{
    isActive: boolean;
    colors: any;
    styles: any;
}> = ({ isActive, colors, styles }) => {
    const width = useSharedValue(isActive ? 12 : 6);
    const backgroundColor = useSharedValue(isActive ? colors.primary : colors.border);

    useEffect(() => {
        width.value = withTiming(isActive ? 12 : 6, { duration: 300 });
        backgroundColor.value = withTiming(
            isActive ? colors.primary : colors.border,
            { duration: 300 }
        );
    }, [isActive, colors.primary, colors.border, width, backgroundColor]);

    const animatedStyle = useAnimatedStyle(() => ({
        width: width.value,
        backgroundColor: backgroundColor.value,
    }));

    return (
        <AnimatedReanimated.View
            style={[
                styles.progressDot,
                animatedStyle,
            ]}
        />
    );
};

/**
 * Post-signup welcome & onboarding screen.
 * - Greets the newly registered user
 * - Lets them immediately set / change their avatar using existing FileManagement picker
 * - Only when the user presses "Continue" do we invoke onAuthenticated to finish flow & close sheet
 */
const WelcomeNewUserScreen: React.FC<BaseScreenProps & { newUser?: any }> = ({
    navigate,
    onAuthenticated,
    theme,
    newUser,
}) => {
    // Use useOxy() hook for OxyContext values
    const { user, oxyServices } = useOxy();
    const { t } = useI18n();
    const updateUser = useAuthStore(s => s.updateUser);
    const currentUser = user || newUser; // fallback
    const normalizedTheme = normalizeTheme(theme);
    const colors = useThemeColors(normalizedTheme);
    const styles = useMemo(() => createStyles(normalizedTheme), [normalizedTheme]);

    // Animation state
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const [currentStep, setCurrentStep] = useState(0);
    // Track avatar separately to ensure it updates immediately after selection
    const [selectedAvatarId, setSelectedAvatarId] = useState<string | undefined>(currentUser?.avatar);

    // Update selectedAvatarId when user changes
    useEffect(() => {
        if (user?.avatar) {
            setSelectedAvatarId(user.avatar);
        } else if (newUser?.avatar) {
            setSelectedAvatarId(newUser.avatar);
        }
    }, [user?.avatar, newUser?.avatar]);

    const avatarUri = selectedAvatarId ? oxyServices.getFileDownloadUrl(selectedAvatarId, 'thumb') : undefined;

    // Steps content
    const welcomeTitle = currentUser?.username
        ? (t('welcomeNew.welcome.titleWithName', { username: currentUser.username }) || `Welcome, ${currentUser.username} 👋`)
        : (t('welcomeNew.welcome.title') || 'Welcome 👋');
    const steps: Array<{ key: string; title: string; bullets?: string[]; body?: string; showAvatar?: boolean; }> = [
        { key: 'welcome', title: welcomeTitle, body: t('welcomeNew.welcome.body') || "You just created an account in a calm, ethical space. A few quick things — then you're in." },
        {
            key: 'account', title: t('welcomeNew.account.title') || 'One Account. Simple.', bullets: [
                t('welcomeNew.account.bullets.0') || 'One identity across everything',
                t('welcomeNew.account.bullets.1') || 'No re‑signing in all the time',
                t('welcomeNew.account.bullets.2') || 'Your preferences stay with you',
            ]
        },
        {
            key: 'principles', title: t('welcomeNew.principles.title') || 'What We Stand For', bullets: [
                t('welcomeNew.principles.bullets.0') || 'Privacy by default',
                t('welcomeNew.principles.bullets.1') || 'No manipulative feeds',
                t('welcomeNew.principles.bullets.2') || 'You decide what to share',
                t('welcomeNew.principles.bullets.3') || 'No selling your data',
            ]
        },
        { key: 'karma', title: t('welcomeNew.karma.title') || 'Karma = Trust & Growth', body: t('welcomeNew.karma.body') || 'Oxy Karma is a points system that reacts to what you do. Helpful, respectful, constructive actions earn it. Harmful or low‑effort stuff chips it away. More karma can unlock benefits; low karma can limit features. It keeps things fair and rewards real contribution.' },
        { key: 'avatar', title: t('welcomeNew.avatar.title') || 'Make It Yours', body: t('welcomeNew.avatar.body') || 'Add an avatar so people recognize you. It will show anywhere you show up here. Skip if you want — you can add it later.', showAvatar: true },
        { key: 'ready', title: t('welcomeNew.ready.title') || "You're Ready", body: t('welcomeNew.ready.body') || 'Explore. Contribute. Earn karma. Stay in control.' }
    ];
    const totalSteps = steps.length;
    const avatarStepIndex = steps.findIndex(s => s.showAvatar);

    const animateToStepCallback = useCallback((next: number) => {
        Animated.timing(fadeAnim, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start(() => {
            setCurrentStep(next);
            slideAnim.setValue(-40);
            Animated.parallel([
                Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== 'web' }),
                Animated.spring(slideAnim, { toValue: 0, useNativeDriver: Platform.OS !== 'web', friction: 9 })
            ]).start();
        });
    }, [fadeAnim, slideAnim]);

    const nextStep = useCallback(() => { if (currentStep < totalSteps - 1) animateToStepCallback(currentStep + 1); }, [currentStep, totalSteps, animateToStepCallback]);
    const prevStep = useCallback(() => { if (currentStep > 0) animateToStepCallback(currentStep - 1); }, [currentStep, animateToStepCallback]);
    const skipToAvatar = useCallback(() => { if (avatarStepIndex >= 0) animateToStepCallback(avatarStepIndex); }, [avatarStepIndex, animateToStepCallback]);
    const finish = useCallback(() => { if (onAuthenticated && currentUser) onAuthenticated(currentUser); }, [onAuthenticated, currentUser]);
    const openAvatarPicker = useCallback(() => {
        // Ensure we're on the avatar step before opening picker
        if (avatarStepIndex >= 0 && currentStep !== avatarStepIndex) {
            animateToStepCallback(avatarStepIndex);
        }

        navigate?.('FileManagement', {
            selectMode: true,
            multiSelect: false,
            disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
            afterSelect: 'none', // Don't navigate away - stay on current screen
            onSelect: async (file: any) => {
                if (!file.contentType.startsWith('image/')) {
                    toast.error(t('editProfile.toasts.selectImage') || 'Please select an image file');
                    return;
                }
                try {
                    // Update file visibility to public for avatar (skip if temporary asset ID)
                    if (file.id && !file.id.startsWith('temp-')) {
                        try {
                            await oxyServices.assetUpdateVisibility(file.id, 'public');
                            console.log('[WelcomeNewUser] Avatar visibility updated to public');
                        } catch (visError: any) {
                            // Only log non-404 errors (404 means asset doesn't exist yet, which is OK)
                            if (visError?.response?.status !== 404) {
                                console.warn('[WelcomeNewUser] Failed to update avatar visibility, continuing anyway:', visError);
                            }
                        }
                    }

                    // Update the avatar immediately in local state
                    setSelectedAvatarId(file.id);
                    
                    // Update user in store
                    await updateUser({ avatar: file.id }, oxyServices);
                    toast.success(t('editProfile.toasts.avatarUpdated') || 'Avatar updated');
                    
                    // Ensure we stay on the avatar step
                    if (avatarStepIndex >= 0 && currentStep !== avatarStepIndex) {
                        animateToStepCallback(avatarStepIndex);
                    }
                } catch (e: any) {
                    toast.error(e.message || t('editProfile.toasts.updateAvatarFailed') || 'Failed to update avatar');
                }
            }
        });
    }, [navigate, updateUser, oxyServices, currentStep, avatarStepIndex, animateToStepCallback, t]);

    const step = steps[currentStep];
    const pillButtons = useMemo(() => {
        if (currentStep === totalSteps - 1) {
            return [
                { text: t('welcomeNew.actions.back') || 'Back', onPress: prevStep, icon: 'arrow-back', variant: 'transparent' },
                { text: t('welcomeNew.actions.enter') || 'Enter', onPress: finish, icon: 'log-in-outline', variant: 'primary' },
            ];
        }
        if (currentStep === 0) {
            const arr: any[] = [];
            if (avatarStepIndex > 0) arr.push({ text: t('welcomeNew.actions.skip') || 'Skip', onPress: skipToAvatar, icon: 'play-skip-forward', variant: 'transparent' });
            arr.push({ text: t('welcomeNew.actions.next') || 'Next', onPress: nextStep, icon: 'arrow-forward', variant: 'primary' });
            return arr;
        }
        if (step.showAvatar) {
            return [
                { text: t('welcomeNew.actions.back') || 'Back', onPress: prevStep, icon: 'arrow-back', variant: 'transparent' },
                { text: avatarUri ? (t('welcomeNew.actions.continue') || 'Continue') : (t('welcomeNew.actions.skip') || 'Skip'), onPress: nextStep, icon: 'arrow-forward', variant: 'primary' },
            ];
        }
        return [
            { text: t('welcomeNew.actions.back') || 'Back', onPress: prevStep, icon: 'arrow-back', variant: 'transparent' },
            { text: t('welcomeNew.actions.next') || 'Next', onPress: nextStep, icon: 'arrow-forward', variant: 'primary' },
        ];
    }, [currentStep, totalSteps, prevStep, nextStep, finish, skipToAvatar, avatarStepIndex, step.showAvatar, avatarUri]);

    return (
        <View style={styles.container}>
            <View style={styles.progressContainer}>
                {steps.map((s, i) => (
                    <AnimatedProgressDot
                        key={s.key}
                        isActive={i === currentStep}
                        colors={colors}
                        styles={styles}
                    />
                ))}
            </View>
            <Animated.View style={{ opacity: fadeAnim, transform: [{ translateX: slideAnim }] }}>
                <View style={[styles.scrollInner, styles.contentContainer]}>
                    <View style={[styles.header, styles.sectionSpacing]}>
                        <Text style={[styles.title, { color: colors.text }]}>{step.title}</Text>
                        {step.body && <Text style={[styles.body, { color: colors.secondaryText }]}>{step.body}</Text>}
                    </View>
                    {Array.isArray(step.bullets) && step.bullets.length > 0 && (
                        <View style={[styles.bulletContainer, styles.sectionSpacing]}>
                            {step.bullets.map(b => (
                                <View key={b} style={styles.bulletRow}>
                                    <Ionicons name="ellipse" size={8} color={colors.primary} style={{ marginTop: 6 }} />
                                    <Text style={[styles.bulletText, { color: colors.secondaryText }]}>{b}</Text>
                                </View>
                            ))}
                        </View>
                    )}
                    {step.showAvatar && (
                        <View style={[styles.avatarSection, styles.sectionSpacing]}>
                            <Avatar 
                                size={120} 
                                name={currentUser?.name?.full || currentUser?.name?.first || currentUser?.username} 
                                uri={avatarUri} 
                                
                                backgroundColor={colors.primary + '20'}
                                style={styles.avatar} 
                            />
                            <TouchableOpacity style={[styles.changeAvatarButton, { backgroundColor: colors.primary }]} onPress={openAvatarPicker}>
                                <Ionicons name="image-outline" size={18} color="#FFFFFF" />
                                <Text style={styles.changeAvatarText}>{avatarUri ? (t('welcomeNew.avatar.change') || 'Change Avatar') : (t('welcomeNew.avatar.add') || 'Add Avatar')}</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                    <View style={styles.sectionSpacing}>
                        <GroupedPillButtons buttons={pillButtons} colors={colors} />
                    </View>
                </View>
            </Animated.View>
        </View>
    );

};

const createStyles = (theme: string) => {
    const isDark = theme === 'dark';
    const border = isDark ? '#333333' : '#E0E0E0';
    return StyleSheet.create({
        container: {
            width: '100%',
            paddingHorizontal: 20,
        },
        scrollInner: {
            paddingTop: 0,
        },
        contentContainer: {
            width: '100%',
            maxWidth: 420,
            alignSelf: 'center',
        },
        sectionSpacing: {
            marginBottom: GAP,
        },
        header: {
            alignItems: 'flex-start',
            width: '100%',
            gap: INNER_GAP / 2,
        },
        title: {
            fontSize: 42,
            fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
            fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
            letterSpacing: -1,
            textAlign: 'left',
        },
        body: {
            fontSize: 16,
            lineHeight: 22,
            textAlign: 'left',
            maxWidth: 320,
            alignSelf: 'flex-start',
        },
        bulletContainer: {
            gap: INNER_GAP,
            width: '100%',
        },
        bulletRow: {
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
        },
        bulletText: {
            flex: 1,
            fontSize: 15,
            lineHeight: 20,
        },
        avatarSection: {
            width: '100%',
            alignItems: 'center',
        },
        avatar: {
            marginBottom: INNER_GAP,
        },
        changeAvatarButton: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 18,
            paddingVertical: 10,
            borderRadius: 28,
            gap: 8,
            shadowOpacity: 0,
            shadowRadius: 0,
            shadowOffset: { width: 0, height: 0 },
            elevation: 0,
            ...(Platform.OS === 'web' ? { boxShadow: 'none' } : null),
        },
        changeAvatarText: {
            color: '#FFFFFF',
            fontSize: 15,
            fontWeight: '600',
        },
        progressContainer: {
            flexDirection: 'row',
            width: '100%',
            justifyContent: 'center',
            marginTop: 24, // Space for bottom sheet handle (~20px) + small buffer
            marginBottom: 24, // Equal spacing below dots
        },
        progressDot: {
            height: 6,
            width: 6,
            borderRadius: 3,
            marginHorizontal: 3,
            backgroundColor: border,
        },
    });
};

export default WelcomeNewUserScreen;
