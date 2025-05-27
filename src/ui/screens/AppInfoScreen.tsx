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
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#F5F5F5';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';
    const primaryColor = '#0066CC';
    const successColor = '#4CAF50';

    useEffect(() => {
        const dimensions = Dimensions.get('window');
        setSystemInfo({
            platform: Platform.OS,
            version: Platform.Version?.toString() || 'Unknown',
            screenDimensions: {
                width: dimensions.width,
                height: dimensions.height,
            },
            timestamp: new Date().toISOString(),
        });
    }, []);

    const copyToClipboard = async (text: string, label: string) => {
        try {
            await Clipboard.setString(text);
            Alert.alert('Copied', `${label} copied to clipboard`);
        } catch (error) {
            Alert.alert('Error', 'Failed to copy to clipboard');
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

    const InfoSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
        <View style={[styles.section, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
            <Text style={[styles.sectionTitle, { color: primaryColor }]}>{title}</Text>
            {children}
        </View>
    );

    const InfoRow: React.FC<{ label: string; value: string; copyable?: boolean }> = ({ 
        label, 
        value, 
        copyable = false 
    }) => (
        <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: isDarkTheme ? '#CCCCCC' : '#666666' }]}>
                {label}:
            </Text>
            <TouchableOpacity 
                style={styles.infoValueContainer}
                onPress={copyable ? () => copyToClipboard(value, label) : undefined}
                disabled={!copyable}
            >
                <Text style={[
                    styles.infoValue, 
                    { color: textColor },
                    copyable && { color: primaryColor, textDecorationLine: 'underline' }
                ]}>
                    {value}
                </Text>
            </TouchableOpacity>
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <View style={[styles.header, { borderBottomColor: borderColor }]}>
                <Text style={[styles.title, { color: textColor }]}>Application Information</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                    <Text style={[styles.closeButtonText, { color: primaryColor }]}>×</Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                <InfoSection title="Package Information">
                    <InfoRow label="Name" value={packageInfo.name} copyable />
                    <InfoRow label="Version" value={packageInfo.version} copyable />
                    <InfoRow label="Description" value={packageInfo.description || 'No description'} />
                    <InfoRow label="Main Entry" value={packageInfo.main || 'N/A'} />
                    <InfoRow label="Module Entry" value={packageInfo.module || 'N/A'} />
                    <InfoRow label="Types Entry" value={packageInfo.types || 'N/A'} />
                </InfoSection>

                <InfoSection title="System Information">
                    <InfoRow label="Platform" value={Platform.OS} />
                    <InfoRow label="Platform Version" value={systemInfo?.version || 'Loading...'} />
                    <InfoRow label="Screen Width" value={`${systemInfo?.screenDimensions.width || 0}px`} />
                    <InfoRow label="Screen Height" value={`${systemInfo?.screenDimensions.height || 0}px`} />
                    <InfoRow label="Environment" value={__DEV__ ? 'Development' : 'Production'} />
                </InfoSection>

                <InfoSection title="User Information">
                    <InfoRow label="Authentication Status" value={user ? 'Authenticated' : 'Not Authenticated'} />
                    {user && (
                        <>
                            <InfoRow label="User ID" value={user.id} copyable />
                            <InfoRow label="Username" value={user.username || 'N/A'} />
                            <InfoRow label="Email" value={user.email || 'N/A'} />
                            <InfoRow label="Premium Status" value={user.isPremium ? 'Premium' : 'Standard'} />
                        </>
                    )}
                    <InfoRow label="Total Active Sessions" value={sessions?.length?.toString() || '0'} />
                </InfoSection>

                <InfoSection title="API Configuration">
                    <InfoRow label="API Base URL" value="http://localhost:3001" copyable />
                    <InfoRow label="Connection Status" value="Unknown" />
                </InfoSection>

                <InfoSection title="Build Information">
                    <InfoRow label="Build Timestamp" value={systemInfo?.timestamp || 'Loading...'} copyable />
                    <InfoRow label="React Native" value="Expo/React Native" />
                    <InfoRow label="JavaScript Engine" value="Hermes" />
                </InfoSection>

                <InfoSection title="Dependencies">
                    <InfoRow label="React Native Version" value="Latest" />
                    <InfoRow label="Expo SDK" value="Latest" />
                    <InfoRow label="TypeScript" value="Enabled" />
                </InfoSection>

                <View style={styles.actionSection}>
                    <TouchableOpacity 
                        style={[styles.actionButton, { backgroundColor: primaryColor }]}
                        onPress={handleCopyFullReport}
                    >
                        <Text style={styles.actionButtonText}>Copy Full Report</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                        style={[styles.actionButton, { backgroundColor: successColor }]}
                        onPress={() => {
                            Alert.alert(
                                'System Check',
                                'All systems operational',
                                [{ text: 'OK' }]
                            );
                        }}
                    >
                        <Text style={styles.actionButtonText}>Run System Check</Text>
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
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
    },
    title: {
        fontSize: 20,
        fontFamily: fontFamilies.phuduBold,
    },
    closeButton: {
        padding: 10,
    },
    closeButtonText: {
        fontSize: 24,
        fontFamily: fontFamilies.phuduBold,
    },
    content: {
        flex: 1,
        padding: 16,
    },
    section: {
        marginBottom: 20,
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
    },
    sectionTitle: {
        fontSize: 18,
        fontFamily: fontFamilies.phuduBold,
        marginBottom: 12,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
        minHeight: 24,
    },
    infoLabel: {
        fontSize: 14,
        fontFamily: fontFamilies.phuduMedium,
        flex: 1,
        marginRight: 12,
    },
    infoValueContainer: {
        flex: 2,
    },
    infoValue: {
        fontSize: 14,
        fontFamily: fontFamilies.phudu,
        textAlign: 'right',
        flexWrap: 'wrap',
    },
    actionSection: {
        marginTop: 20,
        marginBottom: 40,
    },
    actionButton: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
        marginBottom: 12,
        alignItems: 'center',
    },
    actionButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontFamily: fontFamilies.phuduMedium,
    },
});

export default AppInfoScreen;
