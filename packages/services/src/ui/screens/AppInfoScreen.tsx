import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';
import { packageInfo } from '../../constants/version';
import { toast } from '../../lib/sonner';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '@expo/vector-icons';
import OxyServicesLogo from '../../assets/icons/OxyServices';


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
    const { user, sessions, oxyServices } = useOxy();
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
            const apiBaseUrl = oxyServices?.getBaseURL() || 'https://api.oxy.so';
            try {
                const response = await fetch(`${apiBaseUrl}/`, {
                    method: 'GET',
                    timeout: 3000,
                } as any);
                
                if (response.ok) {
                    setConnectionStatus('connected');
                } else {
                    setConnectionStatus('disconnected');
                }
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
        if (!oxyServices) {
            toast.error('OxyServices not initialized');
            return;
        }

        setIsRunningSystemCheck(true);
        const checks = [];
        
        // Get the API base URL from the services instance
        const apiBaseUrl = oxyServices?.getBaseURL() || 'https://api.oxy.so'; // Default for now, could be made configurable
        
        try {
            // Check 1: API Server Health
            checks.push('🔍 Checking API server connection...');
            toast.info('Running system checks...', { duration: 2000 });
            
            try {
                const response = await fetch(`${apiBaseUrl}/`, {
                    method: 'GET',
                    timeout: 5000,
                } as any);
                
                if (response.ok) {
                    const data = await response.json();
                    checks.push('✅ API server is responding');
                    checks.push(`📊 Server stats: ${data.users || 0} users`);
                    checks.push(`🌐 API URL: ${apiBaseUrl}`);
                    setConnectionStatus('connected');
                } else {
                    checks.push('❌ API server returned error status');
                    checks.push(`   Status: ${response.status} ${response.statusText}`);
                    setConnectionStatus('disconnected');
                }
            } catch (error) {
                checks.push('❌ API server connection failed');
                checks.push(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                checks.push(`   URL: ${apiBaseUrl}`);
                setConnectionStatus('disconnected');
            }

            // Check 2: Authentication Status
            checks.push('🔍 Checking authentication...');
            if (oxyServices.isAuthenticated()) {
                checks.push('✅ User is authenticated');
                
                // Check 3: Token Validation
                try {
                    const isValid = await oxyServices.validate();
                    if (isValid) {
                        checks.push('✅ Authentication token is valid');
                    } else {
                        checks.push('❌ Authentication token is invalid');
                    }
                } catch (error) {
                    checks.push('❌ Token validation failed');
                    checks.push(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            } else {
                checks.push('⚠️ User is not authenticated');
            }

            // Check 4: Session Validation (if user has active sessions)
            if (user && sessions && sessions.length > 0) {
                checks.push('🔍 Checking active sessions...');
                try {
                    // Just check if we can fetch sessions
                    const userSessions = await oxyServices.getUserSessions();
                    checks.push(`✅ Session validation successful (${userSessions.length} sessions)`);
                } catch (error) {
                    checks.push('❌ Session validation failed');
                    checks.push(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Check 5: Platform Information
            checks.push('🔍 Checking platform information...');
            checks.push(`✅ Platform: ${Platform.OS} ${Platform.Version || 'Unknown'}`);
            checks.push(`✅ Screen: ${systemInfo?.screenDimensions.width || 0}x${systemInfo?.screenDimensions.height || 0}`);
            checks.push(`✅ Environment: ${__DEV__ ? 'Development' : 'Production'}`);

            // Check 6: Package Information
            checks.push('🔍 Checking package information...');
            checks.push(`✅ Package: ${packageInfo.name}@${packageInfo.version}`);
            
            // Check 7: Memory and Performance (basic)
            checks.push('🔍 Checking performance metrics...');
            const memoryUsage = (performance as any).memory;
            if (memoryUsage) {
                const usedMB = Math.round(memoryUsage.usedJSHeapSize / 1024 / 1024);
                const totalMB = Math.round(memoryUsage.totalJSHeapSize / 1024 / 1024);
                checks.push(`✅ Memory usage: ${usedMB}MB / ${totalMB}MB`);
            } else {
                checks.push('✅ Performance metrics not available on this platform');
            }

            // Final summary
            const errorCount = checks.filter(check => check.includes('❌')).length;
            const warningCount = checks.filter(check => check.includes('⚠️')).length;
            
            checks.push('');
            checks.push('📋 SYSTEM CHECK SUMMARY:');
            if (errorCount === 0 && warningCount === 0) {
                checks.push('✅ All systems operational');
                toast.success('System check completed - All systems operational!');
            } else if (errorCount === 0) {
                checks.push(`⚠️ ${warningCount} warning(s) found`);
                toast.warning(`System check completed with ${warningCount} warning(s)`);
            } else {
                checks.push(`❌ ${errorCount} error(s) and ${warningCount} warning(s) found`);
                toast.error(`System check failed with ${errorCount} error(s)`);
            }

            // Show results in an alert and copy to clipboard
            const report = checks.join('\n');
            Alert.alert(
                'System Check Results',
                `Check completed. Results copied to clipboard.\n\nSummary: ${errorCount} errors, ${warningCount} warnings`,
                [
                    { text: 'View Full Report', onPress: () => copyToClipboard(report, 'System check report') },
                    { text: 'OK', style: 'default' }
                ]
            );

        } catch (error) {
            toast.error('System check failed to run');
            console.error('System check error:', error);
        } finally {
            setIsRunningSystemCheck(false);
        }
    };

    const generateFullReport = () => {
        const report = {
            packageInfo: {
                name: packageInfo.name,
                version: packageInfo.version,
                description: packageInfo.description,
            },
            systemInfo,
            userInfo: {
                isAuthenticated: !!user,
                userId: user?.id || 'Not authenticated',
                username: user?.username || 'N/A',
                totalUsers: sessions?.length || 0,
            },
            apiConfiguration: {
                apiUrl: oxyServices?.getBaseURL() || 'Not configured',
            },
            buildInfo: {
                timestamp: new Date().toISOString(),
                environment: __DEV__ ? 'Development' : 'Production',
            },
        };

        return JSON.stringify(report, null, 2);
    };

    const handleCopyFullReport = () => {
        const report = generateFullReport();
        copyToClipboard(report, 'Full application report');
    };

    const InfoRow: React.FC<{ 
        label: string; 
        value: string; 
        copyable?: boolean;
        icon?: string;
        iconComponent?: React.ReactNode;
        color?: string;
        isFirst?: boolean;
        isLast?: boolean;
        onPress?: () => void;
        showChevron?: boolean;
    }> = ({ 
        label, 
        value, 
        copyable = false,
        icon = 'information-circle',
        iconComponent,
        color = '#8E8E93',
        isFirst = false,
        isLast = false,
        onPress,
        showChevron = false,
    }) => {
        const handlePress = () => {
            if (onPress) {
                onPress();
            } else if (copyable) {
                copyToClipboard(value, label);
            }
        };

        const isInteractive = copyable || !!onPress;

        return (
            <TouchableOpacity 
                style={[
                    styles.settingItem,
                    isFirst && styles.firstSettingItem,
                    isLast && styles.lastSettingItem,
                ]}
                onPress={isInteractive ? handlePress : undefined}
                disabled={!isInteractive}
            >
                <View style={styles.settingInfo}>
                    {iconComponent ? (
                        React.cloneElement(iconComponent as React.ReactElement, { style: styles.settingIcon })
                    ) : (
                        <OxyIcon name={icon} size={20} color={color} style={styles.settingIcon} />
                    )}
                    <View style={styles.settingDetails}>
                        <Text style={styles.settingLabel}>{label}</Text>
                        <Text style={[
                            styles.settingValue,
                            (copyable || onPress) && { color: primaryColor }
                        ]}>
                            {value}
                        </Text>
                    </View>
                </View>
                {copyable && <OxyIcon name="copy" size={16} color="#ccc" />}
                {showChevron && <OxyIcon name="chevron-forward" size={16} color="#ccc" />}
            </TouchableOpacity>
        );
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
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Package Information</Text>
                    
                    <InfoRow 
                        label="Name" 
                        value={packageInfo.name} 
                        copyable 
                        iconComponent={<OxyServicesLogo width={20} height={20} />}
                        color="#007AFF"
                        isFirst
                    />
                    <InfoRow 
                        label="Version" 
                        value={packageInfo.version} 
                        copyable 
                        icon="pricetag"
                        color="#5856D6"
                    />
                    <InfoRow 
                        label="Description" 
                        value={packageInfo.description || 'No description'} 
                        icon="document-text"
                        color="#34C759"
                    />
                    <InfoRow 
                        label="Main Entry" 
                        value={packageInfo.main || 'N/A'} 
                        icon="code"
                        color="#FF9500"
                    />
                    <InfoRow 
                        label="Module Entry" 
                        value={packageInfo.module || 'N/A'} 
                        icon="library"
                        color="#FF3B30"
                    />
                    <InfoRow 
                        label="Types Entry" 
                        value={packageInfo.types || 'N/A'} 
                        icon="construct"
                        color="#32D74B"
                        isLast
                    />
                </View>

                {/* System Information */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>System Information</Text>
                    
                    <InfoRow 
                        label="Platform" 
                        value={Platform.OS} 
                        icon="phone-portrait"
                        color="#007AFF"
                        isFirst
                    />
                    <InfoRow 
                        label="Platform Version" 
                        value={systemInfo?.version || 'Loading...'} 
                        icon="hardware-chip"
                        color="#5856D6"
                    />
                    <InfoRow 
                        label="Screen Width" 
                        value={`${systemInfo?.screenDimensions.width || 0}px`} 
                        icon="resize"
                        color="#FF9500"
                    />
                    <InfoRow 
                        label="Screen Height" 
                        value={`${systemInfo?.screenDimensions.height || 0}px`} 
                        icon="resize"
                        color="#FF3B30"
                    />
                    <InfoRow 
                        label="Environment" 
                        value={__DEV__ ? 'Development' : 'Production'} 
                        icon="settings"
                        color="#34C759"
                        isLast
                    />
                </View>

                {/* User Information */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>User Information</Text>
                    
                    <InfoRow 
                        label="Authentication Status" 
                        value={user ? 'Authenticated' : 'Not Authenticated'} 
                        icon="shield-checkmark"
                        color={user ? '#34C759' : '#FF3B30'}
                        isFirst
                    />
                    {user && (
                        <>
                            <InfoRow 
                                label="User ID" 
                                value={user.id} 
                                copyable 
                                icon="person"
                                color="#007AFF"
                            />
                            <InfoRow 
                                label="Username" 
                                value={user.username || 'N/A'} 
                                icon="at"
                                color="#5856D6"
                                onPress={() => {
                                    if (user?.username && navigate) {
                                        navigate('Profile', { userId: user.id });
                                    } else {
                                        toast.info('No username available or navigation not supported');
                                    }
                                }}
                                showChevron={true}
                            />
                            <InfoRow 
                                label="Email" 
                                value={user.email || 'N/A'} 
                                icon="mail"
                                color="#FF9500"
                            />
                            <InfoRow 
                                label="Premium Status" 
                                value={user.isPremium ? 'Premium' : 'Standard'} 
                                icon="star"
                                color={user.isPremium ? '#FFD700' : '#8E8E93'}
                            />
                        </>
                    )}
                    <InfoRow 
                        label="Total Active Sessions" 
                        value={sessions?.length?.toString() || '0'} 
                        icon="people"
                        color="#32D74B"
                        isLast
                    />
                </View>

                {/* API Configuration */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>API Configuration</Text>
                    
                    <InfoRow 
                        label="API Base URL" 
                        value={oxyServices?.getBaseURL() || 'Not configured'} 
                        copyable 
                        icon="server"
                        color="#007AFF"
                        isFirst
                    />
                    <InfoRow 
                        label="Connection Status" 
                        value={
                            connectionStatus === 'checking' ? 'Checking...' :
                            connectionStatus === 'connected' ? 'Connected' :
                            connectionStatus === 'disconnected' ? 'Disconnected' :
                            'Unknown'
                        }
                        icon={
                            connectionStatus === 'checking' ? 'sync' :
                            connectionStatus === 'connected' ? 'wifi' :
                            'wifi-off'
                        }
                        color={
                            connectionStatus === 'checking' ? '#FF9500' :
                            connectionStatus === 'connected' ? '#34C759' :
                            '#FF3B30'
                        }
                        onPress={async () => {
                            setConnectionStatus('checking');
                            const apiBaseUrl = oxyServices?.getBaseURL() || 'https://api.oxy.so';
                            try {
                                const response = await fetch(`${apiBaseUrl}/`, {
                                    method: 'GET',
                                    timeout: 3000,
                                } as any);
                                
                                if (response.ok) {
                                    setConnectionStatus('connected');
                                    toast.success('API connection successful');
                                } else {
                                    setConnectionStatus('disconnected');
                                    toast.error(`API server error: ${response.status}`);
                                }
                            } catch (error) {
                                setConnectionStatus('disconnected');
                                toast.error('Failed to connect to API server');
                            }
                        }}
                        showChevron={true}
                        isLast
                    />
                </View>

                {/* Build Information */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Build Information</Text>
                    
                    <InfoRow 
                        label="Build Timestamp" 
                        value={systemInfo?.timestamp || 'Loading...'} 
                        copyable 
                        icon="time"
                        color="#007AFF"
                        isFirst
                    />
                    <InfoRow 
                        label="React Native" 
                        value="Expo/React Native" 
                        icon="logo-react"
                        color="#61DAFB"
                    />
                    <InfoRow 
                        label="JavaScript Engine" 
                        value="Hermes" 
                        icon="flash"
                        color="#FF3B30"
                        isLast
                    />
                </View>

                {/* Quick Actions */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Quick Actions</Text>
                    
                    <TouchableOpacity 
                        style={[styles.settingItem, styles.firstSettingItem]}
                        onPress={handleCopyFullReport}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="copy" size={20} color="#007AFF" style={styles.settingIcon} />
                            <View style={styles.settingDetails}>
                                <Text style={styles.settingLabel}>Copy Full Report</Text>
                                <Text style={styles.settingDescription}>
                                    Copy complete application information to clipboard
                                </Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                        style={[
                            styles.settingItem, 
                            styles.lastSettingItem,
                            isRunningSystemCheck && styles.disabledSettingItem
                        ]}
                        onPress={runSystemCheck}
                        disabled={isRunningSystemCheck}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon 
                                name={isRunningSystemCheck ? "sync" : "checkmark-circle"} 
                                size={20} 
                                color={isRunningSystemCheck ? "#FF9500" : "#34C759"} 
                                style={[
                                    styles.settingIcon,
                                    isRunningSystemCheck && styles.spinningIcon
                                ]} 
                            />
                            <View style={styles.settingDetails}>
                                <Text style={styles.settingLabel}>
                                    {isRunningSystemCheck ? 'Running System Check...' : 'Run System Check'}
                                </Text>
                                <Text style={styles.settingDescription}>
                                    {isRunningSystemCheck 
                                        ? 'Checking API, authentication, and platform status...' 
                                        : 'Verify application health and status'
                                    }
                                </Text>
                            </View>
                        </View>
                        {!isRunningSystemCheck && <OxyIcon name="chevron-forward" size={16} color="#ccc" />}
                    </TouchableOpacity>
                </View>
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
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    settingItem: {
        backgroundColor: '#fff',
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
    },
    firstSettingItem: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    lastSettingItem: {
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 8,
    },
    settingInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    settingIcon: {
        marginRight: 12,
    },
    settingDetails: {
        flex: 1,
    },
    settingLabel: {
        fontSize: 16,
        fontWeight: '500',
        color: '#333',
        marginBottom: 2,
    },
    settingValue: {
        fontSize: 14,
        color: '#666',
    },
    settingDescription: {
        fontSize: 14,
        color: '#999',
    },
    disabledSettingItem: {
        opacity: 0.6,
    },
    spinningIcon: {
        // Note: Animation would need to be implemented with Animated API
        // For now, just showing the sync icon to indicate loading
    },
});

export default AppInfoScreen;
