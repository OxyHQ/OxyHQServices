import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Animated, ScrollView } from 'react-native';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import Avatar from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { useAuthStore } from '../stores/authStore';
import { useThemeColors } from '../styles';
import GroupedPillButtons from '../components/internal/GroupedPillButtons';

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
    const { user, oxyServices } = useOxy();
    const updateUser = useAuthStore(s => s.updateUser);
    const currentUser = user || newUser; // fallback
    const colors = useThemeColors(theme);
    const styles = useMemo(() => createStyles(theme), [theme]);

    // Animation state
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const [currentStep, setCurrentStep] = useState(0);

    const avatarUri = currentUser?.avatar ? oxyServices.getFileDownloadUrl(currentUser.avatar as string, 'thumb') : undefined;

    // Steps content
    const steps: Array<{ key: string; title: string; bullets?: string[]; body?: string; showAvatar?: boolean; }> = [
        { key: 'welcome', title: `Welcome${currentUser?.username ? `, ${currentUser.username}` : ''} 👋`, body: 'You just created an account in a calm, ethical space. A few quick things — then you\'re in.' },
        { key: 'account', title: 'One Account. Simple.', bullets: ['One identity across everything', 'No re‑signing in all the time', 'Your preferences stay with you'] },
        { key: 'principles', title: 'What We Stand For', bullets: ['Privacy by default', 'No manipulative feeds', 'You decide what to share', 'No selling your data'] },
        { key: 'karma', title: 'Karma = Trust & Growth', body: 'Oxy Karma is a points system that reacts to what you do. Helpful, respectful, constructive actions earn it. Harmful or low‑effort stuff chips it away. More karma can unlock benefits; low karma can limit features. It keeps things fair and rewards real contribution.' },
        { key: 'avatar', title: 'Make It Yours', body: 'Add an avatar so people recognize you. It will show anywhere you show up here. Skip if you want — you can add it later.', showAvatar: true },
        { key: 'ready', title: 'You\'re Ready', body: 'Explore. Contribute. Earn karma. Stay in control.' }
    ];
    const totalSteps = steps.length;
    const avatarStepIndex = steps.findIndex(s => s.showAvatar);

    const animateToStep = (next: number) => {
        Animated.timing(fadeAnim, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start(() => {
            setCurrentStep(next);
            slideAnim.setValue(-40);
            Animated.parallel([
                Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== 'web' }),
                Animated.spring(slideAnim, { toValue: 0, useNativeDriver: Platform.OS !== 'web', friction: 9 })
            ]).start();
        });
    };

    const nextStep = useCallback(() => { if (currentStep < totalSteps - 1) animateToStep(currentStep + 1); }, [currentStep, totalSteps]);
    const prevStep = useCallback(() => { if (currentStep > 0) animateToStep(currentStep - 1); }, [currentStep]);
    const skipToAvatar = useCallback(() => { if (avatarStepIndex >= 0) animateToStep(avatarStepIndex); }, [avatarStepIndex]);
    const finish = useCallback(() => { if (onAuthenticated && currentUser) onAuthenticated(currentUser); }, [onAuthenticated, currentUser]);
    const openAvatarPicker = useCallback(() => {
        navigate('FileManagement', {
            selectMode: true,
            multiSelect: false,
            disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
            afterSelect: 'back',
            onSelect: async (file: any) => {
                if (!file.contentType.startsWith('image/')) { toast.error('Please select an image file'); return; }
                try { await updateUser({ avatar: file.id }, oxyServices); toast.success('Avatar updated'); } catch (e: any) { toast.error(e.message || 'Failed to update avatar'); }
            }
        });
    }, [navigate, updateUser, oxyServices]);

    const step = steps[currentStep];
    const pillButtons = useMemo(() => {
        if (currentStep === totalSteps - 1) {
            return [
                { text: 'Back', onPress: prevStep, icon: 'arrow-back', variant: 'transparent' },
                { text: 'Enter', onPress: finish, icon: 'log-in-outline', variant: 'primary' },
            ];
        }
        if (currentStep === 0) {
            const arr: any[] = [];
            if (avatarStepIndex > 0) arr.push({ text: 'Skip', onPress: skipToAvatar, icon: 'play-skip-forward', variant: 'transparent' });
            arr.push({ text: 'Next', onPress: nextStep, icon: 'arrow-forward', variant: 'primary' });
            return arr;
        }
        if (step.showAvatar) {
            return [
                { text: 'Back', onPress: prevStep, icon: 'arrow-back', variant: 'transparent' },
                { text: avatarUri ? 'Continue' : 'Skip', onPress: nextStep, icon: 'arrow-forward', variant: 'primary' },
            ];
        }
        return [
            { text: 'Back', onPress: prevStep, icon: 'arrow-back', variant: 'transparent' },
            { text: 'Next', onPress: nextStep, icon: 'arrow-forward', variant: 'primary' },
        ];
    }, [currentStep, totalSteps, prevStep, nextStep, finish, skipToAvatar, avatarStepIndex, step.showAvatar, avatarUri]);

    return (
        <View style={styles.container}>
            <View style={styles.progressContainer}>
                {steps.map((s, i) => (
                    <View key={s.key} style={[styles.progressDot, i === currentStep ? { backgroundColor: colors.primary, width: 22 } : { backgroundColor: colors.border }]} />
                ))}
            </View>
            <Animated.View style={{ opacity: fadeAnim, transform: [{ translateX: slideAnim }] }}>
                <ScrollView contentContainerStyle={styles.scrollInner} showsVerticalScrollIndicator={false}>
                    <Text style={styles.title}>{step.title}</Text>
                    {step.body && <Text style={styles.body}>{step.body}</Text>}
                    {Array.isArray(step.bullets) && step.bullets.length > 0 && (
                        <View style={styles.bulletContainer}>
                            {step.bullets.map(b => (
                                <View key={b} style={styles.bulletRow}>
                                    <Ionicons name="ellipse" size={8} color={colors.primary} style={{ marginTop: 6 }} />
                                    <Text style={styles.bulletText}>{b}</Text>
                                </View>
                            ))}
                        </View>
                    )}
                    {step.showAvatar && (
                        <View style={styles.avatarSection}>
                            <Avatar size={120} name={currentUser?.username} uri={avatarUri} theme={theme} style={styles.avatar} />
                            <TouchableOpacity style={styles.changeAvatarButton} onPress={openAvatarPicker}>
                                <Ionicons name="image-outline" size={18} color="#FFFFFF" />
                                <Text style={styles.changeAvatarText}>{avatarUri ? 'Change Avatar' : 'Add Avatar'}</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                    <GroupedPillButtons buttons={pillButtons} colors={colors} />
                </ScrollView>
            </Animated.View>
        </View>
    );

};

const createStyles = (theme: string) => {
    const isDark = theme === 'dark';
    const textColor = isDark ? '#FFFFFF' : '#000000';
    const secondary = isDark ? '#CCCCCC' : '#555555';
    const cardBg = isDark ? '#1E1E1E' : '#FFFFFF';
    const border = isDark ? '#333333' : '#E0E0E0';
    const primary = '#007AFF';
    return StyleSheet.create({
        container: {
            width: '100%',
            paddingHorizontal: 20,
        },
        scrollInner: {
            paddingBottom: 12,
        },
        title: {
            fontSize: 42,
            fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
            fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
            letterSpacing: -1,
            color: textColor,
            marginBottom: 12,
        },
        body: {
            fontSize: 16,
            lineHeight: 22,
            color: secondary,
            marginBottom: 28,
            maxWidth: 620,
        },
        bulletContainer: {
            gap: 10,
            marginBottom: 32,
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
            color: secondary,
        },
        avatarSection: {
            width: '100%',
            alignItems: 'center',
            marginBottom: 40,
        },
        avatar: {
            marginBottom: 16,
            borderWidth: 4,
            borderColor: primary + '40',
        },
        changeAvatarButton: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: primary,
            paddingHorizontal: 18,
            paddingVertical: 10,
            borderRadius: 35,
            gap: 8,
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
            marginBottom: 24,
            marginTop: 4,
        },
        progressDot: {
            height: 10,
            width: 10,
            borderRadius: 5,
            marginHorizontal: 6,
            backgroundColor: border,
        },
        navBar: {
            flexDirection: 'row',
            alignItems: 'center',
            width: '100%',
            gap: 12,
            marginTop: 8,
        },
        navButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 12,
        },
        backButton: {
            backgroundColor: cardBg,
            borderWidth: 1,
            borderColor: border,
        },
        skipButton: {
            marginLeft: 'auto',
            backgroundColor: 'transparent',
            paddingHorizontal: 4,
        },
        navText: {
            fontSize: 14,
            fontWeight: '500',
        },
        primaryButton: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            backgroundColor: primary,
            paddingVertical: 18,
            borderRadius: 16,
            width: '100%',
        },
        primaryButtonText: {
            color: '#FFFFFF',
            fontSize: 16,
            fontWeight: '600',
            letterSpacing: 0.5,
        },
    });
};

export default WelcomeNewUserScreen;
