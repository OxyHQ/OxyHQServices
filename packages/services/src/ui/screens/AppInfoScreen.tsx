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
    const { user, sessions } = useOxy();
    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

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
                apiUrl: 'http://localhost:3001',
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
                    <OxyIcon name={icon} size={20} color={color} style={styles.settingIcon} />
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
                        icon="apps"
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
                        value="http://localhost:3001" 
                        copyable 
                        icon="server"
                        color="#007AFF"
                        isFirst
                    />
                    <InfoRow 
                        label="Connection Status" 
                        value="Unknown" 
                        icon="wifi"
                        color="#8E8E93"
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
                        style={[styles.settingItem, styles.lastSettingItem]}
                        onPress={() => {
                            toast.success('All systems operational');
                        }}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="checkmark-circle" size={20} color="#34C759" style={styles.settingIcon} />
                            <View style={styles.settingDetails}>
                                <Text style={styles.settingLabel}>Run System Check</Text>
                                <Text style={styles.settingDescription}>
                                    Verify application health and status
                                </Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
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
        fontFamily: fontFamilies.phuduMedium,
    },
    settingValue: {
        fontSize: 14,
        color: '#666',
        fontFamily: fontFamilies.phudu,
    },
    settingDescription: {
        fontSize: 14,
        color: '#999',
        fontFamily: fontFamilies.phudu,
    },
});

export default AppInfoScreen;
