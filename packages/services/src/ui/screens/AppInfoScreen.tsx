import type React from 'react';
import { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Platform,
    Dimensions,
    Clipboard,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { fontFamilies } from '../styles/fonts';
import { packageInfo } from '@oxyhq/core';
import { toast } from '../../lib/sonner';
import { Ionicons } from '@expo/vector-icons';
import OxyServicesLogo from '../../assets/icons/OxyServices';
import { SettingsIcon } from '../components/SettingsIcon';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/useColorScheme';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';


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
                <SettingsListGroup title={t('appInfo.sections.package')}>
                    <SettingsListItem
                        icon={<OxyServicesLogo width={20} height={20} />}
                        title={t('appInfo.items.name')}
                        description={packageInfo.name}
                        onPress={() => copyToClipboard(packageInfo.name, t('appInfo.items.name'))}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="tag" color={themeStyles.colors.iconData} />}
                        title={t('appInfo.items.version')}
                        description={packageInfo.version}
                        onPress={() => copyToClipboard(packageInfo.version, t('appInfo.items.version'))}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="file-document" color={themeStyles.colors.iconPersonalInfo} />}
                        title={t('appInfo.items.description')}
                        description={packageInfo.description || t('appInfo.items.noDescription')}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="code-tags" color={themeStyles.colors.iconStorage} />}
                        title={t('appInfo.items.mainEntry')}
                        description={packageInfo.main || 'N/A'}
                        onPress={() => copyToClipboard(packageInfo.main || 'N/A', t('appInfo.items.mainEntry'))}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="library" color={themeStyles.colors.iconSharing} />}
                        title={t('appInfo.items.moduleEntry')}
                        description={packageInfo.module || 'N/A'}
                        onPress={() => copyToClipboard(packageInfo.module || 'N/A', t('appInfo.items.moduleEntry'))}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="wrench" color={themeStyles.colors.iconPersonalInfo} />}
                        title={t('appInfo.items.typesEntry')}
                        description={packageInfo.types || 'N/A'}
                        onPress={() => copyToClipboard(packageInfo.types || 'N/A', t('appInfo.items.typesEntry'))}
                    />
                </SettingsListGroup>

                {/* System Information */}
                <SettingsListGroup title={t('appInfo.sections.system')}>
                    <SettingsListItem
                        icon={<SettingsIcon name="cellphone" color={themeStyles.colors.iconSecurity} />}
                        title={t('appInfo.items.platform')}
                        description={Platform.OS}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="chip" color={themeStyles.colors.iconData} />}
                        title={t('appInfo.items.platformVersion')}
                        description={systemInfo?.version || t('common.status.loading')}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="resize" color={themeStyles.colors.iconStorage} />}
                        title={t('appInfo.items.screenWidth')}
                        description={`${systemInfo?.screenDimensions.width || 0}px`}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="resize" color={themeStyles.colors.iconSharing} />}
                        title={t('appInfo.items.screenHeight')}
                        description={`${systemInfo?.screenDimensions.height || 0}px`}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="cog" color={themeStyles.colors.iconPersonalInfo} />}
                        title={t('appInfo.items.environment')}
                        description={__DEV__ ? t('appInfo.items.development') : t('appInfo.items.production')}
                    />
                </SettingsListGroup>

                {/* User Information */}
                <SettingsListGroup title={t('appInfo.sections.user')}>
                    <SettingsListItem
                        icon={<SettingsIcon name="shield-check" color={isAuthenticated ? themeStyles.colors.iconPersonalInfo : themeStyles.colors.iconSharing} />}
                        title={t('appInfo.items.authStatus')}
                        description={isAuthenticated ? t('appInfo.items.authenticated') : t('appInfo.items.notAuthenticated')}
                    />
                    {user && (
                        <>
                            <SettingsListItem
                                icon={<SettingsIcon name="account" color={themeStyles.colors.iconSecurity} />}
                                title={t('appInfo.items.userId')}
                                description={user.id}
                                onPress={() => copyToClipboard(user.id, t('appInfo.items.userId'))}
                            />
                            <SettingsListItem
                                icon={<SettingsIcon name="at" color={themeStyles.colors.iconData} />}
                                title={t('appInfo.items.username')}
                                description={user.username || 'N/A'}
                                onPress={() => {
                                    if (user?.username && navigate) {
                                        navigate('Profile', { userId: user.id });
                                    } else {
                                        toast.info(t('appInfo.toasts.noUsernameOrNav'));
                                    }
                                }}
                            />
                            <SettingsListItem
                                icon={<SettingsIcon name="email" color={themeStyles.colors.iconStorage} />}
                                title={t('appInfo.items.email')}
                                description={user.email || 'N/A'}
                            />
                            <SettingsListItem
                                icon={<SettingsIcon name="star" color={user.isPremium ? '#FFD700' : '#8E8E93'} />}
                                title={t('appInfo.items.premiumStatus')}
                                description={user.isPremium ? t('appInfo.items.premium') : t('appInfo.items.standard')}
                            />
                        </>
                    )}
                    <SettingsListItem
                        icon={<SettingsIcon name="account-group" color={themeStyles.colors.iconPersonalInfo} />}
                        title={t('appInfo.items.totalActiveSessions')}
                        description={sessions?.length?.toString() || '0'}
                    />
                </SettingsListGroup>

                {/* API Configuration */}
                <SettingsListGroup title={t('appInfo.sections.api')}>
                    <SettingsListItem
                        icon={<SettingsIcon name="server" color={themeStyles.colors.iconSecurity} />}
                        title={t('appInfo.items.apiBaseUrl')}
                        description={oxyServices?.getBaseURL() || t('appInfo.items.notConfigured')}
                        onPress={() => copyToClipboard(oxyServices?.getBaseURL() || t('appInfo.items.notConfigured'), t('appInfo.items.apiBaseUrl'))}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon
                            name={connectionStatus === 'checking' ? 'sync' : connectionStatus === 'connected' ? 'wifi' : 'wifi-off'}
                            color={connectionStatus === 'checking' ? themeStyles.colors.iconStorage : connectionStatus === 'connected' ? themeStyles.colors.iconPersonalInfo : themeStyles.colors.iconSharing}
                        />}
                        title={t('appInfo.items.connectionStatus')}
                        description={connectionStatus === 'checking' ? t('appInfo.items.checking') : connectionStatus === 'connected' ? t('appInfo.items.connected') : connectionStatus === 'disconnected' ? t('appInfo.items.disconnected') : t('appInfo.items.unknown')}
                        onPress={async () => {
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
                        }}
                    />
                </SettingsListGroup>

                {/* Build Information */}
                <SettingsListGroup title={t('appInfo.sections.build')}>
                    <SettingsListItem
                        icon={<SettingsIcon name="clock" color={themeStyles.colors.iconSecurity} />}
                        title={t('appInfo.items.buildTimestamp')}
                        description={systemInfo?.timestamp || t('common.status.loading')}
                        onPress={() => copyToClipboard(systemInfo?.timestamp || t('common.status.loading'), t('appInfo.items.buildTimestamp'))}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="react" color="#61DAFB" />}
                        title={t('appInfo.items.reactNative')}
                        description={t('appInfo.items.reactNativeValue')}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="flash" color={themeStyles.colors.iconSharing} />}
                        title={t('appInfo.items.jsEngine')}
                        description={t('appInfo.items.jsEngineValue')}
                    />
                </SettingsListGroup>

                {/* Quick Actions */}
                <SettingsListGroup title={t('appInfo.sections.quickActions')}>
                    <SettingsListItem
                        icon={<SettingsIcon name="content-copy" color={themeStyles.colors.iconSecurity} />}
                        title={t('appInfo.items.copyFullReport')}
                        description={t('appInfo.items.copyFullReportSubtitle')}
                        onPress={handleCopyFullReport}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon
                            name={isRunningSystemCheck ? 'sync' : 'check-circle'}
                            color={isRunningSystemCheck ? '#FF9500' : '#34C759'}
                        />}
                        title={isRunningSystemCheck ? t('appInfo.items.runningSystemCheck') : t('appInfo.items.runSystemCheck')}
                        description={isRunningSystemCheck
                            ? t('appInfo.items.systemCheckRunning')
                            : t('appInfo.items.systemCheckSubtitle')}
                        onPress={runSystemCheck}
                        disabled={isRunningSystemCheck}
                        rightElement={isRunningSystemCheck ? (
                            <ActivityIndicator color="#FF9500" size="small" />
                        ) : undefined}
                    />
                </SettingsListGroup>
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
});

export default AppInfoScreen;
