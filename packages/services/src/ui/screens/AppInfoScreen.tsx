import type React from 'react';
import { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Platform,
    Dimensions,
    Alert,
    Clipboard,
    SafeAreaView,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { fontFamilies } from '../styles/fonts';
import { packageInfo } from '@oxyhq/core';
import { toast } from '../../lib/sonner';
import { confirmAction } from '../utils/confirmAction';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '@expo/vector-icons';
import OxyServicesLogo from '../../assets/icons/OxyServices';
import { Section, GroupedSection } from '../components';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/useColorScheme';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';


interface SystemInfo {
    platform: string;
    version: string;
    screenDimensions: {
        width: number;
        height: number;
    };
    timestamp: string;
}

const AppInfoScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
}) => {
    // Use useOxy() hook for OxyContext values
    const { user, sessions, oxyServices, isAuthenticated } = useOxy();
    const { t } = useI18n();
    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
    const [isRunningSystemCheck, setIsRunningSystemCheck] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected' | 'unknown'>('unknown');

    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme || 'light', colorScheme);
    // AppInfoScreen uses a slightly different light background
    const backgroundColor = themeStyles.isDarkTheme ? themeStyles.backgroundColor : '#f2f2f2';
    const primaryColor = themeStyles.colors.iconSecurity;

    useEffect(() => {
        const updateDimensions = () => {
            const dimensions = Dimensions.get('window');
            setSystemInfo(prev => ({
                ...prev,
                platform: Platform.OS,
                version: Platform.Version?.toString() || 'Unknown',
                screenDimensions: {
                    width: dimensions.width,
                    height: dimensions.height,
                },
                timestamp: new Date().toISOString(),
            }));
        };

        // Set initial dimensions
        updateDimensions();

        // Listen for dimension changes
        const subscription = Dimensions.addEventListener('change', updateDimensions);

        // Check API connection on mount
        const checkConnection = async () => {
            setConnectionStatus('checking');

            if (!oxyServices) {
                setConnectionStatus('disconnected');
                return;
            }

            try {
                await oxyServices.healthCheck();
                setConnectionStatus('connected');
            } catch (error) {
                setConnectionStatus('disconnected');
            }
        };

        checkConnection();

        // Cleanup listener on unmount
        return () => {
            subscription?.remove();
        };
    }, [oxyServices]);

    const copyToClipboard = async (text: string, label: string) => {
        try {
            await Clipboard.setString(text);
            toast.success(t('appInfo.toasts.copiedToClipboard', { label }));
        } catch (error) {
            toast.error(t('appInfo.toasts.copyFailed'));
        }
    };

    const runSystemCheck = async () => {
        setIsRunningSystemCheck(true);

        try {
            // Simulate system check
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Check API connection
            if (oxyServices) {
                try {
                    await oxyServices.healthCheck();
                    setConnectionStatus('connected');
                } catch (error) {
                    setConnectionStatus('disconnected');
                }
            }

            toast.success(t('appInfo.toasts.systemCheckSuccess'));
        } catch (error) {
            toast.error(t('appInfo.toasts.systemCheckFailed'));
        } finally {
            setIsRunningSystemCheck(false);
        }
    };

    const generateFullReport = () => {
        const report = {
            package: packageInfo,
            system: systemInfo,
            user: user ? {
                id: user.id,
                username: user.username,
                email: user.email,
                isPremium: user.isPremium,
            } : null,
            sessions: sessions?.length || 0,
            connection: connectionStatus,
            timestamp: new Date().toISOString(),
        };

        return JSON.stringify(report, null, 2);
    };

    const handleCopyFullReport = () => {
        const report = generateFullReport();
        copyToClipboard(report, t('appInfo.items.copyFullReport'));
    };

    return (
        <View style={[styles.container, { backgroundColor }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                    <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('appInfo.title')}</Text>
                <View style={styles.placeholder} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Package Information */}
                <Section title={t('appInfo.sections.package')} >
                    <GroupedSection
                        items={[
                            {
                                id: 'name',
                                icon: 'information',
                                iconColor: themeStyles.colors.iconSecurity,
                                title: t('appInfo.items.name'),
                                subtitle: packageInfo.name,
                                onPress: () => copyToClipboard(packageInfo.name, t('appInfo.items.name')),
                                customContent: <OxyServicesLogo width={20} height={20} style={styles.settingIcon} />,
                            },
                            {
                                id: 'version',
                                icon: 'tag',
                                iconColor: themeStyles.colors.iconData,
                                title: t('appInfo.items.version'),
                                subtitle: packageInfo.version,
                                onPress: () => copyToClipboard(packageInfo.version, t('appInfo.items.version')),
                            },
                            {
                                id: 'description',
                                icon: 'file-document',
                                iconColor: themeStyles.colors.iconPersonalInfo,
                                title: t('appInfo.items.description'),
                                subtitle: packageInfo.description || t('appInfo.items.noDescription'),
                            },
                            {
                                id: 'main-entry',
                                icon: 'code-tags',
                                iconColor: themeStyles.colors.iconStorage,
                                title: t('appInfo.items.mainEntry'),
                                subtitle: packageInfo.main || 'N/A',
                                onPress: () => copyToClipboard(packageInfo.main || 'N/A', t('appInfo.items.mainEntry')),
                            },
                            {
                                id: 'module-entry',
                                icon: 'library',
                                iconColor: themeStyles.colors.iconSharing,
                                title: t('appInfo.items.moduleEntry'),
                                subtitle: packageInfo.module || 'N/A',
                                onPress: () => copyToClipboard(packageInfo.module || 'N/A', t('appInfo.items.moduleEntry')),
                            },
                            {
                                id: 'types-entry',
                                icon: 'wrench',
                                iconColor: themeStyles.colors.iconPersonalInfo,
                                title: t('appInfo.items.typesEntry'),
                                subtitle: packageInfo.types || 'N/A',
                                onPress: () => copyToClipboard(packageInfo.types || 'N/A', t('appInfo.items.typesEntry')),
                            },
                        ]}
                    />
                </Section>

                {/* System Information */}
                <Section title={t('appInfo.sections.system')} >
                    <GroupedSection
                        items={[
                            {
                                id: 'platform',
                                icon: 'cellphone',
                                iconColor: themeStyles.colors.iconSecurity,
                                title: t('appInfo.items.platform'),
                                subtitle: Platform.OS,
                            },
                            {
                                id: 'platform-version',
                                icon: 'chip',
                                iconColor: themeStyles.colors.iconData,
                                title: t('appInfo.items.platformVersion'),
                                subtitle: systemInfo?.version || t('common.status.loading'),
                            },
                            {
                                id: 'screen-width',
                                icon: 'resize',
                                iconColor: themeStyles.colors.iconStorage,
                                title: t('appInfo.items.screenWidth'),
                                subtitle: `${systemInfo?.screenDimensions.width || 0}px`,
                            },
                            {
                                id: 'screen-height',
                                icon: 'resize',
                                iconColor: themeStyles.colors.iconSharing,
                                title: t('appInfo.items.screenHeight'),
                                subtitle: `${systemInfo?.screenDimensions.height || 0}px`,
                            },
                            {
                                id: 'environment',
                                icon: 'cog',
                                iconColor: themeStyles.colors.iconPersonalInfo,
                                title: t('appInfo.items.environment'),
                                subtitle: __DEV__ ? t('appInfo.items.development') : t('appInfo.items.production'),
                            },
                        ]}
                    />
                </Section>

                {/* User Information */}
                <Section title={t('appInfo.sections.user')} >
                    <GroupedSection
                        items={[
                            {
                                id: 'auth-status',
                                icon: 'shield-check',
                                iconColor: isAuthenticated ? themeStyles.colors.iconPersonalInfo : themeStyles.colors.iconSharing,
                                title: t('appInfo.items.authStatus'),
                                subtitle: isAuthenticated ? t('appInfo.items.authenticated') : t('appInfo.items.notAuthenticated'),
                            },
                            ...(user ? [
                                {
                                    id: 'user-id',
                                    icon: 'account',
                                    iconColor: themeStyles.colors.iconSecurity,
                                    title: t('appInfo.items.userId'),
                                    subtitle: user.id,
                                    onPress: () => copyToClipboard(user.id, t('appInfo.items.userId')),
                                },
                                {
                                    id: 'username',
                                    icon: 'at',
                                    iconColor: themeStyles.colors.iconData,
                                    title: t('appInfo.items.username'),
                                    subtitle: user.username || 'N/A',
                                    onPress: () => {
                                        if (user?.username && navigate) {
                                            navigate('Profile', { userId: user.id });
                                        } else {
                                            toast.info(t('appInfo.toasts.noUsernameOrNav'));
                                        }
                                    },
                                },
                                {
                                    id: 'email',
                                    icon: 'mail',
                                    iconColor: themeStyles.colors.iconStorage,
                                    title: t('appInfo.items.email'),
                                    subtitle: user.email || 'N/A',
                                },
                                {
                                    id: 'premium-status',
                                    icon: 'star',
                                    iconColor: user.isPremium ? '#FFD700' : '#8E8E93',
                                    title: t('appInfo.items.premiumStatus'),
                                    subtitle: user.isPremium ? t('appInfo.items.premium') : t('appInfo.items.standard'),
                                },
                            ] : []),
                            {
                                id: 'active-sessions',
                                icon: 'account-group',
                                iconColor: themeStyles.colors.iconPersonalInfo,
                                title: t('appInfo.items.totalActiveSessions'),
                                subtitle: sessions?.length?.toString() || '0',
                            },
                        ]}
                    />
                </Section>

                {/* API Configuration */}
                <Section title={t('appInfo.sections.api')} >
                    <GroupedSection
                        items={[
                            {
                                id: 'api-base-url',
                                icon: 'server',
                                iconColor: themeStyles.colors.iconSecurity,
                                title: t('appInfo.items.apiBaseUrl'),
                                subtitle: oxyServices?.getBaseURL() || t('appInfo.items.notConfigured'),
                                onPress: () => copyToClipboard(oxyServices?.getBaseURL() || t('appInfo.items.notConfigured'), t('appInfo.items.apiBaseUrl')),
                            },
                            {
                                id: 'connection-status',
                                icon: connectionStatus === 'checking' ? 'sync' : connectionStatus === 'connected' ? 'wifi' : 'wifi-off',
                                iconColor: connectionStatus === 'checking' ? themeStyles.colors.iconStorage : connectionStatus === 'connected' ? themeStyles.colors.iconPersonalInfo : themeStyles.colors.iconSharing,
                                title: t('appInfo.items.connectionStatus'),
                                subtitle: connectionStatus === 'checking' ? t('appInfo.items.checking') : connectionStatus === 'connected' ? t('appInfo.items.connected') : connectionStatus === 'disconnected' ? t('appInfo.items.disconnected') : t('appInfo.items.unknown'),
                                onPress: async () => {
                                    setConnectionStatus('checking');

                                    if (!oxyServices) {
                                        setConnectionStatus('disconnected');
                                        toast.error(t('appInfo.toasts.oxyServicesNotInitialized'));
                                        return;
                                    }

                                    try {
                                        await oxyServices.healthCheck();
                                        setConnectionStatus('connected');
                                        toast.success(t('appInfo.toasts.apiConnectionSuccess'));
                                    } catch (error) {
                                        setConnectionStatus('disconnected');
                                        toast.error(t('appInfo.toasts.apiConnectionFailed'));
                                    }
                                },
                            },
                        ]}
                    />
                </Section>

                {/* Build Information */}
                <Section title={t('appInfo.sections.build')} >
                    <GroupedSection
                        items={[
                            {
                                id: 'build-timestamp',
                                icon: 'clock',
                                iconColor: themeStyles.colors.iconSecurity,
                                title: t('appInfo.items.buildTimestamp'),
                                subtitle: systemInfo?.timestamp || t('common.status.loading'),
                                onPress: () => copyToClipboard(systemInfo?.timestamp || t('common.status.loading'), t('appInfo.items.buildTimestamp')),
                            },
                            {
                                id: 'react-native',
                                icon: 'react',
                                iconColor: '#61DAFB',
                                title: t('appInfo.items.reactNative'),
                                subtitle: t('appInfo.items.reactNativeValue'),
                            },
                            {
                                id: 'js-engine',
                                icon: 'flash',
                                iconColor: themeStyles.colors.iconSharing,
                                title: t('appInfo.items.jsEngine'),
                                subtitle: t('appInfo.items.jsEngineValue'),
                            },
                        ]}
                    />
                </Section>

                {/* Quick Actions */}
                <Section title={t('appInfo.sections.quickActions')} >
                    <GroupedSection
                        items={[
                            {
                                id: 'copy-full-report',
                                icon: 'content-copy',
                                iconColor: themeStyles.colors.iconSecurity,
                                title: t('appInfo.items.copyFullReport'),
                                subtitle: t('appInfo.items.copyFullReportSubtitle'),
                                onPress: handleCopyFullReport,
                            },
                            {
                                id: 'run-system-check',
                                icon: isRunningSystemCheck ? 'sync' : 'check-circle',
                                iconColor: isRunningSystemCheck ? '#FF9500' : '#34C759',
                                title: isRunningSystemCheck ? t('appInfo.items.runningSystemCheck') : t('appInfo.items.runSystemCheck'),
                                subtitle: isRunningSystemCheck
                                    ? t('appInfo.items.systemCheckRunning')
                                    : t('appInfo.items.systemCheckSubtitle'),
                                onPress: runSystemCheck,
                                disabled: isRunningSystemCheck,
                                customContent: isRunningSystemCheck ? (
                                    <ActivityIndicator color="#FF9500" size="small" style={{ marginRight: 16 }} />
                                ) : null,
                            },
                        ]}
                    />
                </Section>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
    },
    cancelButton: {
        padding: 5,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#000',
        fontFamily: fontFamilies.interBold,
    },
    placeholder: {
        width: 34, // Same width as cancel button to center title
    },
    content: {
        flex: 1,
        padding: 16,
    },
    settingIcon: {
        marginRight: 12,
    },
});

export default AppInfoScreen;
