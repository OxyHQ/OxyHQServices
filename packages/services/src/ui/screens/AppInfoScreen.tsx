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
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';
import { packageInfo } from '../../constants/version';
import { toast } from '../../lib/sonner';
import { confirmAction } from '../utils/confirmAction';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '@expo/vector-icons';
import OxyServicesLogo from '../../assets/icons/OxyServices';
import { Section, GroupedSection } from '../components';


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
    const { user, sessions, oxyServices, isAuthenticated } = useOxy();
    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
    const [isRunningSystemCheck, setIsRunningSystemCheck] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected' | 'unknown'>('unknown');

    const isDarkTheme = theme === 'dark';
    const backgroundColor = isDarkTheme ? '#121212' : '#f2f2f2';
    const primaryColor = '#007AFF';

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
    }, []);

    const copyToClipboard = async (text: string, label: string) => {
        try {
            await Clipboard.setString(text);
            toast.success(`${label} copied to clipboard`);
        } catch (error) {
            toast.error('Failed to copy to clipboard');
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

            toast.success('System check completed successfully');
        } catch (error) {
            toast.error('System check failed');
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
        copyToClipboard(report, 'Full system report');
    };

    return (
        <View style={[styles.container, { backgroundColor }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                    <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>App Information</Text>
                <View style={styles.placeholder} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Package Information */}
                <Section title="Package Information" theme={theme}>
                    <GroupedSection
                        items={[
                            {
                                id: 'name',
                                icon: 'information-circle',
                                iconColor: '#007AFF',
                                title: 'Name',
                                subtitle: packageInfo.name,
                                onPress: () => copyToClipboard(packageInfo.name, 'Package name'),
                                customContent: <OxyServicesLogo width={20} height={20} style={styles.settingIcon} />,
                            },
                            {
                                id: 'version',
                                icon: 'pricetag',
                                iconColor: '#5856D6',
                                title: 'Version',
                                subtitle: packageInfo.version,
                                onPress: () => copyToClipboard(packageInfo.version, 'Version'),
                            },
                            {
                                id: 'description',
                                icon: 'document-text',
                                iconColor: '#34C759',
                                title: 'Description',
                                subtitle: packageInfo.description || 'No description',
                            },
                            {
                                id: 'main-entry',
                                icon: 'code',
                                iconColor: '#FF9500',
                                title: 'Main Entry',
                                subtitle: packageInfo.main || 'N/A',
                                onPress: () => copyToClipboard(packageInfo.main || 'N/A', 'Main entry'),
                            },
                            {
                                id: 'module-entry',
                                icon: 'library',
                                iconColor: '#FF3B30',
                                title: 'Module Entry',
                                subtitle: packageInfo.module || 'N/A',
                                onPress: () => copyToClipboard(packageInfo.module || 'N/A', 'Module entry'),
                            },
                            {
                                id: 'types-entry',
                                icon: 'construct',
                                iconColor: '#32D74B',
                                title: 'Types Entry',
                                subtitle: packageInfo.types || 'N/A',
                                onPress: () => copyToClipboard(packageInfo.types || 'N/A', 'Types entry'),
                            },
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* System Information */}
                <Section title="System Information" theme={theme}>
                    <GroupedSection
                        items={[
                            {
                                id: 'platform',
                                icon: 'phone-portrait',
                                iconColor: '#007AFF',
                                title: 'Platform',
                                subtitle: Platform.OS,
                            },
                            {
                                id: 'platform-version',
                                icon: 'hardware-chip',
                                iconColor: '#5856D6',
                                title: 'Platform Version',
                                subtitle: systemInfo?.version || 'Loading...',
                            },
                            {
                                id: 'screen-width',
                                icon: 'resize',
                                iconColor: '#FF9500',
                                title: 'Screen Width',
                                subtitle: `${systemInfo?.screenDimensions.width || 0}px`,
                            },
                            {
                                id: 'screen-height',
                                icon: 'resize',
                                iconColor: '#FF3B30',
                                title: 'Screen Height',
                                subtitle: `${systemInfo?.screenDimensions.height || 0}px`,
                            },
                            {
                                id: 'environment',
                                icon: 'settings',
                                iconColor: '#34C759',
                                title: 'Environment',
                                subtitle: __DEV__ ? 'Development' : 'Production',
                            },
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* User Information */}
                <Section title="User Information" theme={theme}>
                    <GroupedSection
                        items={[
                            {
                                id: 'auth-status',
                                icon: 'shield-checkmark',
                                iconColor: isAuthenticated ? '#34C759' : '#FF3B30',
                                title: 'Authentication Status',
                                subtitle: isAuthenticated ? 'Authenticated' : 'Not Authenticated',
                            },
                            ...(user ? [
                                {
                                    id: 'user-id',
                                    icon: 'person',
                                    iconColor: '#007AFF',
                                    title: 'User ID',
                                    subtitle: user.id,
                                    onPress: () => copyToClipboard(user.id, 'User ID'),
                                },
                                {
                                    id: 'username',
                                    icon: 'at',
                                    iconColor: '#5856D6',
                                    title: 'Username',
                                    subtitle: user.username || 'N/A',
                                    onPress: () => {
                                        if (user?.username && navigate) {
                                            navigate('Profile', { userId: user.id });
                                        } else {
                                            toast.info('No username available or navigation not supported');
                                        }
                                    },
                                },
                                {
                                    id: 'email',
                                    icon: 'mail',
                                    iconColor: '#FF9500',
                                    title: 'Email',
                                    subtitle: user.email || 'N/A',
                                },
                                {
                                    id: 'premium-status',
                                    icon: 'star',
                                    iconColor: user.isPremium ? '#FFD700' : '#8E8E93',
                                    title: 'Premium Status',
                                    subtitle: user.isPremium ? 'Premium' : 'Standard',
                                },
                            ] : []),
                            {
                                id: 'active-sessions',
                                icon: 'people',
                                iconColor: '#32D74B',
                                title: 'Total Active Sessions',
                                subtitle: sessions?.length?.toString() || '0',
                            },
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* API Configuration */}
                <Section title="API Configuration" theme={theme}>
                    <GroupedSection
                        items={[
                            {
                                id: 'api-base-url',
                                icon: 'server',
                                iconColor: '#007AFF',
                                title: 'API Base URL',
                                subtitle: oxyServices?.getBaseURL() || 'Not configured',
                                onPress: () => copyToClipboard(oxyServices?.getBaseURL() || 'Not configured', 'API Base URL'),
                            },
                            {
                                id: 'connection-status',
                                icon: connectionStatus === 'checking' ? 'sync' : connectionStatus === 'connected' ? 'wifi' : 'wifi-off',
                                iconColor: connectionStatus === 'checking' ? '#FF9500' : connectionStatus === 'connected' ? '#34C759' : '#FF3B30',
                                title: 'Connection Status',
                                subtitle: connectionStatus === 'checking' ? 'Checking...' : connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'disconnected' ? 'Disconnected' : 'Unknown',
                                onPress: async () => {
                                    setConnectionStatus('checking');

                                    if (!oxyServices) {
                                        setConnectionStatus('disconnected');
                                        toast.error('OxyServices not initialized');
                                        return;
                                    }

                                    try {
                                        await oxyServices.healthCheck();
                                        setConnectionStatus('connected');
                                        toast.success('API connection successful');
                                    } catch (error) {
                                        setConnectionStatus('disconnected');
                                        toast.error('Failed to connect to API server');
                                    }
                                },
                            },
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* Build Information */}
                <Section title="Build Information" theme={theme}>
                    <GroupedSection
                        items={[
                            {
                                id: 'build-timestamp',
                                icon: 'time',
                                iconColor: '#007AFF',
                                title: 'Build Timestamp',
                                subtitle: systemInfo?.timestamp || 'Loading...',
                                onPress: () => copyToClipboard(systemInfo?.timestamp || 'Loading...', 'Build timestamp'),
                            },
                            {
                                id: 'react-native',
                                icon: 'logo-react',
                                iconColor: '#61DAFB',
                                title: 'React Native',
                                subtitle: 'Expo/React Native',
                            },
                            {
                                id: 'js-engine',
                                icon: 'flash',
                                iconColor: '#FF3B30',
                                title: 'JavaScript Engine',
                                subtitle: 'Hermes',
                            },
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* Quick Actions */}
                <Section title="Quick Actions" theme={theme}>
                    <GroupedSection
                        items={[
                            {
                                id: 'copy-full-report',
                                icon: 'copy',
                                iconColor: '#007AFF',
                                title: 'Copy Full Report',
                                subtitle: 'Copy complete application information to clipboard',
                                onPress: handleCopyFullReport,
                            },
                            {
                                id: 'run-system-check',
                                icon: isRunningSystemCheck ? 'sync' : 'checkmark-circle',
                                iconColor: isRunningSystemCheck ? '#FF9500' : '#34C759',
                                title: isRunningSystemCheck ? 'Running System Check...' : 'Run System Check',
                                subtitle: isRunningSystemCheck
                                    ? 'Checking API, authentication, and platform status...'
                                    : 'Verify application health and status',
                                onPress: runSystemCheck,
                                disabled: isRunningSystemCheck,
                                customContent: isRunningSystemCheck ? (
                                    <ActivityIndicator color="#FF9500" size="small" style={{ marginRight: 16 }} />
                                ) : null,
                            },
                        ]}
                        theme={theme}
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
        fontFamily: fontFamilies.phuduBold,
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
