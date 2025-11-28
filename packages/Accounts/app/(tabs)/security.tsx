import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { LinkButton, AccountCard, AppleSwitch } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';

export default function SecurityScreen() {
    const colorScheme = useColorScheme() ?? 'light';
    const { width } = useWindowDimensions();

    const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
    const isDesktop = Platform.OS === 'web' && width >= 768;

    const [skipPassword, setSkipPassword] = useState(true);
    const [enhancedSafeBrowsing, setEnhancedSafeBrowsing] = useState(false);
    const [darkWebReport, setDarkWebReport] = useState(false);

    const securityRecommendation = useMemo(() => [
        {
            id: 'recommendation',
            customIcon: (
                <View style={[styles.recommendationIconContainer, { backgroundColor: '#FFC107' }]}>
                    <MaterialCommunityIcons name="shield-alert" size={22} color={darkenColor('#FFC107')} />
                </View>
            ),
            title: 'You have security recommendations',
            subtitle: 'Recommended actions found in the Security Checkup',
        },
    ], []);

    const recentActivity = useMemo(() => [
        {
            id: 'activity1',
            icon: 'monitor',
            iconColor: colors.sidebarIconDevices,
            title: 'New sign-in on Windows',
            subtitle: 'Nov 25',
        },
        {
            id: 'activity2',
            icon: 'monitor',
            iconColor: colors.sidebarIconDevices,
            title: 'New sign-in on Windows',
            subtitle: 'Nov 5 Spain',
        },
    ], [colors]);

    const signInItems = useMemo(() => [
        {
            id: '2fa',
            icon: 'shield-check-outline',
            iconColor: colors.sidebarIconSecurity,
            title: '2-Step Verification',
            subtitle: 'On since Jul 8, 2019',
            customContent: (
                <View style={styles.statusContainer}>
                    <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                </View>
            ),
        },
        {
            id: 'passkeys',
            icon: 'key-variant',
            iconColor: colors.sidebarIconSecurity,
            title: 'Passkeys and security keys',
            subtitle: '6 passkeys',
        },
        {
            id: 'password',
            icon: 'dots-horizontal',
            iconColor: colors.sidebarIconSecurity,
            title: 'Password',
            subtitle: 'Last changed Oct 27, 2021',
        },
        {
            id: 'skip-password',
            icon: 'key-off-outline',
            iconColor: colors.sidebarIconSecurity,
            title: 'Skip password when possible',
            subtitle: skipPassword ? 'On' : 'Off',
            customContent: (
                <AppleSwitch
                    value={skipPassword}
                    onValueChange={setSkipPassword}
                />
            ),
        },
        {
            id: 'authenticator',
            icon: 'grid',
            iconColor: colors.sidebarIconSecurity,
            title: 'Authenticator',
            subtitle: 'Added Mar 8, 2020',
        },
        {
            id: 'google-prompt',
            icon: 'cellphone',
            iconColor: colors.sidebarIconSecurity,
            title: 'Oxy prompt',
            subtitle: '3 devices',
        },
        {
            id: '2fa-phones',
            icon: 'message-text-outline',
            iconColor: colors.sidebarIconSecurity,
            title: '2-Step Verification phones',
            subtitle: '680 72 76 77',
        },
        {
            id: 'recovery-phone',
            icon: 'cellphone',
            iconColor: colors.sidebarIconSecurity,
            title: 'Recovery phone',
            subtitle: '680 72 76 77',
        },
        {
            id: 'recovery-email',
            icon: 'email-outline',
            iconColor: colors.sidebarIconSecurity,
            title: 'Recovery email',
            subtitle: 'nate.isern.alvarez@gmail.com',
            customContent: (
                <View style={styles.statusContainer}>
                    <Ionicons name="warning" size={20} color="#FFC107" />
                </View>
            ),
        },
        {
            id: 'pin',
            icon: 'dialpad',
            iconColor: colors.sidebarIconSecurity,
            title: 'Oxy Account PIN',
            subtitle: 'Last changed Jan 7, 2020',
        },
        {
            id: 'backup-codes',
            icon: 'grid',
            iconColor: colors.sidebarIconSecurity,
            title: 'Backup codes',
            subtitle: '10 codes available',
        },
    ], [colors, skipPassword]);

    const actionButtons = useMemo(() => [
        {
            id: 'recovery-contacts',
            icon: 'account-outline',
            iconColor: colors.sidebarIconPersonalInfo,
            title: 'Recovery contacts',
        },
        {
            id: 'backup-phones',
            icon: 'shield-outline',
            iconColor: colors.sidebarIconSecurity,
            title: 'Backup 2-Step Verification phones',
        },
    ], [colors]);

    const deviceItems = useMemo(() => [
        {
            id: 'windows',
            icon: 'monitor',
            iconColor: colors.sidebarIconDevices,
            title: '2 sessions on Windows computer(s)',
            subtitle: 'Windows, Windows',
        },
        {
            id: 'android',
            icon: 'cellphone',
            iconColor: colors.sidebarIconDevices,
            title: '3 sessions on Android device(s)',
            subtitle: 'Android, Redmi M2101K6G,...',
        },
        {
            id: 'chrome',
            icon: 'monitor',
            iconColor: colors.sidebarIconDevices,
            title: '1 session on Chrome device',
            subtitle: 'Google Pixelbook',
        },
    ], [colors]);

    const thirdPartyItems = useMemo(() => [
        {
            id: 'airbnb',
            icon: 'home-outline',
            iconColor: colors.sidebarIconSharing,
            title: 'Airbnb',
            subtitle: 'Connected',
        },
        {
            id: 'alexa',
            icon: 'amazon',
            iconColor: colors.sidebarIconSharing,
            title: 'Amazon Alexa',
            subtitle: 'Connected',
        },
        {
            id: 'android-police',
            icon: 'newspaper-outline',
            iconColor: colors.sidebarIconSharing,
            title: 'Android Police',
            subtitle: 'Connected',
        },
    ], [colors]);

    const featureCards = useMemo(() => [
        {
            id: 'safe-browsing',
            icon: 'shield-check-outline',
            iconColor: colors.sidebarIconSecurity,
            title: 'Enhanced Safe Browsing for your account',
            subtitle: 'More personalized protections against dangerous websites, downloads, and extensions.',
            customContent: (
                <AppleSwitch
                    value={enhancedSafeBrowsing}
                    onValueChange={setEnhancedSafeBrowsing}
                />
            ),
        },
        {
            id: 'dark-web',
            icon: 'magnify',
            iconColor: colors.sidebarIconData,
            title: 'Dark web report',
            subtitle: 'Start monitoring to get alerts and guidance if your info is found on the dark web',
            customContent: (
                <AppleSwitch
                    value={darkWebReport}
                    onValueChange={setDarkWebReport}
                />
            ),
        },
        {
            id: 'password-manager',
            icon: 'key-outline',
            iconColor: colors.sidebarIconPassword,
            title: 'Password Manager',
            subtitle: 'You have 1026 passwords saved in your Oxy Account. Password Manager makes it easier to sign in to sites and apps you use on any signed-in device.',
        },
    ], [colors, enhancedSafeBrowsing, darkWebReport]);


    const renderContent = () => (
        <>
            <AccountCard>
                <GroupedSection items={securityRecommendation} />
            </AccountCard>

            <Section title="Recent security activity">
                <AccountCard>
                    <GroupedSection items={recentActivity} />
                </AccountCard>
                <LinkButton text="Review security activity" />
            </Section>

            <Section title="How you sign in to Oxy">
                <ThemedText style={styles.sectionSubtitle}>Make sure you can always access your Oxy Account by keeping this information up to date</ThemedText>
                <AccountCard>
                    <GroupedSection items={signInItems} />
                </AccountCard>
                <ThemedText style={styles.sectionSubtitle}>You can add more sign-in options</ThemedText>
                <AccountCard>
                    <GroupedSection items={actionButtons} />
                </AccountCard>
            </Section>

            <Section title="Your devices">
                <ThemedText style={styles.sectionSubtitle}>Where you're signed in</ThemedText>
                <AccountCard>
                    <GroupedSection items={deviceItems} />
                </AccountCard>
                <View style={styles.deviceActions}>
                    <LinkButton text="Find a lost device" icon="target" />
                    <LinkButton text="Manage all devices" count="12" />
                </View>
            </Section>

            <Section title="Your connections to third-party apps & services">
                <ThemedText style={styles.sectionSubtitle}>Keep track of your connections to third-party apps and services</ThemedText>
                <AccountCard>
                    <GroupedSection items={thirdPartyItems} />
                </AccountCard>
                <LinkButton text="See all connections" count="68" />
            </Section>

            <AccountCard>
                <GroupedSection items={featureCards} />
            </AccountCard>
        </>
    );

    if (isDesktop) {
        return (
            <>
                <View style={styles.headerSection}>
                    <ThemedText style={styles.title}>Security & sign-in</ThemedText>
                </View>
                {renderContent()}
            </>
        );
    }

    return (
        <ScreenContentWrapper>
            <View style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.mobileContent}>
                    <View style={styles.mobileHeaderSection}>
                        <ThemedText style={styles.mobileTitle}>Security & sign-in</ThemedText>
                    </View>
                    {renderContent()}
                </View>
            </View>
        </ScreenContentWrapper>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    desktopBody: {
        flex: 1,
        flexDirection: 'row',
    },
    desktopMain: {
        flex: 1,
        maxWidth: 720,
    },
    desktopMainContent: {
        padding: 32,
    },
    headerSection: {
        marginBottom: 24,
    },
    title: {
        fontSize: 32,
        fontWeight: '600',
        marginBottom: 8,
    },
    recommendationIconContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionSubtitle: {
        fontSize: 14,
        opacity: 0.7,
        marginBottom: 12,
    },
    statusContainer: {
        marginLeft: 8,
    },
    deviceActions: {
        flexDirection: 'row',
        gap: 24,
        marginTop: 8,
    },
    mobileContent: {
        padding: 16,
        paddingBottom: 120,
    },
    mobileHeaderSection: {
        marginBottom: 20,
    },
    mobileTitle: {
        fontSize: 28,
        fontWeight: '600',
        marginBottom: 6,
    },
});
