import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { toast } from '../../../lib/sonner';
import OxyIcon from '../../components/icon/OxyIcon';
import { fontFamilies } from '../../styles/fonts';

interface SecuritySectionProps {
    hasTwoFactorEnabled: boolean;
    lastPasswordChange?: string;
    activeSessions: number;
    onUpdatePassword: () => void;
    onToggleTwoFactor: () => void;
    onManageSessions: () => void;
    onSecurityLog: () => void;
}

const SecuritySection: React.FC<SecuritySectionProps> = ({
    hasTwoFactorEnabled,
    lastPasswordChange,
    activeSessions,
    onUpdatePassword,
    onToggleTwoFactor,
    onManageSessions,
    onSecurityLog,
}) => {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Security</Text>

            <TouchableOpacity
                style={[styles.settingItem, styles.firstSettingItem]}
                onPress={onUpdatePassword}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="lock-closed" size={20} color="#FF3B30" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Change Password</Text>
                        <Text style={styles.settingDescription}>
                            {lastPasswordChange ? `Last changed ${lastPasswordChange}` : 'Set a strong password'}
                        </Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.settingItem}
                onPress={onToggleTwoFactor}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="shield-checkmark" size={20} color="#30D158" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Two-Factor Authentication</Text>
                        <Text style={styles.settingDescription}>
                            {hasTwoFactorEnabled ? 'Enabled' : 'Add an extra layer of security'}
                        </Text>
                    </View>
                </View>
                <View style={styles.settingValue}>
                    <View style={[styles.statusBadge, hasTwoFactorEnabled ? styles.enabled : styles.disabled]}>
                        <Text style={styles.statusText}>
                            {hasTwoFactorEnabled ? 'ON' : 'OFF'}
                        </Text>
                    </View>
                    <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                </View>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.settingItem}
                onPress={onManageSessions}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="desktop" size={20} color="#007AFF" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Active Sessions</Text>
                        <Text style={styles.settingDescription}>
                            {activeSessions} device{activeSessions !== 1 ? 's' : ''} currently signed in
                        </Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.settingItem, styles.lastSettingItem]}
                onPress={onSecurityLog}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="document-text" size={20} color="#5856D6" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Security Log</Text>
                        <Text style={styles.settingDescription}>Review recent account activity</Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    section: { marginBottom: 24 },
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
    firstSettingItem: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
    lastSettingItem: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24, marginBottom: 8 },
    settingInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    settingIcon: { marginRight: 12 },
    settingLabel: { fontSize: 16, fontWeight: '500', color: '#333', marginBottom: 2 },
    settingDescription: { fontSize: 14, color: '#666' },
    settingValue: { flexDirection: 'row', alignItems: 'center' },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        marginRight: 8,
    },
    enabled: { backgroundColor: '#30D158' },
    disabled: { backgroundColor: '#8E8E93' },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#fff',
    },
});

export default React.memo(SecuritySection); 