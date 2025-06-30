import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { toast } from '../../../lib/sonner';
import OxyIcon from '../../components/icon/OxyIcon';
import { fontFamilies } from '../../styles/fonts';

interface AccountSectionProps {
    accountCreated: string;
    lastLogin: string;
    onDeactivateAccount: () => void;
    onDeleteAccount: () => void;
    onLogout: () => void;
    onHelpSupport: () => void;
    onTermsPrivacy: () => void;
}

const AccountSection: React.FC<AccountSectionProps> = ({
    accountCreated,
    lastLogin,
    onDeactivateAccount,
    onDeleteAccount,
    onLogout,
    onHelpSupport,
    onTermsPrivacy,
}) => {
    const handleDeactivateAccount = () => {
        Alert.alert(
            'Deactivate Account',
            'Are you sure you want to deactivate your account? You can reactivate it later by signing in.',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Deactivate', style: 'destructive', onPress: onDeactivateAccount },
            ]
        );
    };

    const handleDeleteAccount = () => {
        Alert.alert(
            'Delete Account',
            'This action cannot be undone. All your data will be permanently deleted.',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: onDeleteAccount },
            ]
        );
    };

    const handleLogout = () => {
        Alert.alert(
            'Sign Out',
            'Are you sure you want to sign out?',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', onPress: onLogout },
            ]
        );
    };

    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account</Text>

            <View style={[styles.settingItem, styles.firstSettingItem]}>
                <View style={styles.settingInfo}>
                    <OxyIcon name="calendar" size={20} color="#007AFF" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Account Created</Text>
                        <Text style={styles.settingDescription}>{accountCreated}</Text>
                    </View>
                </View>
            </View>

            <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                    <OxyIcon name="time" size={20} color="#FF9500" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Last Login</Text>
                        <Text style={styles.settingDescription}>{lastLogin}</Text>
                    </View>
                </View>
            </View>

            <TouchableOpacity
                style={styles.settingItem}
                onPress={onHelpSupport}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="help-circle" size={20} color="#5856D6" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Help & Support</Text>
                        <Text style={styles.settingDescription}>Get help and contact support</Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.settingItem}
                onPress={onTermsPrivacy}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="document-text" size={20} color="#8E8E93" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Terms & Privacy</Text>
                        <Text style={styles.settingDescription}>Read our terms and privacy policy</Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.settingItem, styles.dangerItem]}
                onPress={handleLogout}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="log-out" size={20} color="#FF9500" style={styles.settingIcon} />
                    <View>
                        <Text style={[styles.settingLabel, styles.dangerText]}>Sign Out</Text>
                        <Text style={styles.settingDescription}>Sign out of your account</Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.settingItem, styles.dangerItem]}
                onPress={handleDeactivateAccount}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="pause-circle" size={20} color="#FF9500" style={styles.settingIcon} />
                    <View>
                        <Text style={[styles.settingLabel, styles.dangerText]}>Deactivate Account</Text>
                        <Text style={styles.settingDescription}>Temporarily disable your account</Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.settingItem, styles.lastSettingItem, styles.dangerItem]}
                onPress={handleDeleteAccount}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="trash" size={20} color="#FF3B30" style={styles.settingIcon} />
                    <View>
                        <Text style={[styles.settingLabel, styles.dangerText]}>Delete Account</Text>
                        <Text style={styles.settingDescription}>Permanently delete your account</Text>
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
    dangerItem: { borderLeftWidth: 3, borderLeftColor: '#FF3B30' },
    dangerText: { color: '#FF3B30' },
});

export default React.memo(AccountSection); 