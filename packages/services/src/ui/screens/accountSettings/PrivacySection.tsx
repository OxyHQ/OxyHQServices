import React from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { toast } from '../../../lib/sonner';
import OxyIcon from '../../components/icon/OxyIcon';
import { fontFamilies } from '../../styles/fonts';

interface PrivacySectionProps {
    profileVisibility: 'public' | 'private' | 'friends';
    showOnlineStatus: boolean;
    allowMessagesFrom: 'everyone' | 'friends' | 'none';
    showActivityStatus: boolean;
    onProfileVisibilityChange: () => void;
    onToggleOnlineStatus: (value: boolean) => void;
    onMessagePrivacyChange: () => void;
    onToggleActivityStatus: (value: boolean) => void;
    onBlockedUsers: () => void;
    onDataExport: () => void;
}

const PrivacySection: React.FC<PrivacySectionProps> = ({
    profileVisibility,
    showOnlineStatus,
    allowMessagesFrom,
    showActivityStatus,
    onProfileVisibilityChange,
    onToggleOnlineStatus,
    onMessagePrivacyChange,
    onToggleActivityStatus,
    onBlockedUsers,
    onDataExport,
}) => {
    const getVisibilityDisplayName = (visibility: string) => {
        switch (visibility) {
            case 'public': return 'Public';
            case 'private': return 'Private';
            case 'friends': return 'Friends Only';
            default: return 'Public';
        }
    };

    const getMessagePrivacyDisplayName = (privacy: string) => {
        switch (privacy) {
            case 'everyone': return 'Everyone';
            case 'friends': return 'Friends Only';
            case 'none': return 'No One';
            default: return 'Friends Only';
        }
    };

    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Privacy</Text>

            <TouchableOpacity
                style={[styles.settingItem, styles.firstSettingItem]}
                onPress={onProfileVisibilityChange}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="eye" size={20} color="#007AFF" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Profile Visibility</Text>
                        <Text style={styles.settingDescription}>Control who can see your profile</Text>
                    </View>
                </View>
                <View style={styles.settingValue}>
                    <Text style={styles.valueText}>{getVisibilityDisplayName(profileVisibility)}</Text>
                    <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                </View>
            </TouchableOpacity>

            <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                    <OxyIcon name="radio-button-on" size={20} color="#30D158" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Show Online Status</Text>
                        <Text style={styles.settingDescription}>Let others see when you're online</Text>
                    </View>
                </View>
                <Switch
                    value={showOnlineStatus}
                    onValueChange={onToggleOnlineStatus}
                    trackColor={{ false: '#E5E5EA', true: '#007AFF' }}
                    thumbColor={showOnlineStatus ? '#fff' : '#fff'}
                />
            </View>

            <TouchableOpacity
                style={styles.settingItem}
                onPress={onMessagePrivacyChange}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="chatbubble" size={20} color="#FF9500" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Message Privacy</Text>
                        <Text style={styles.settingDescription}>Control who can send you messages</Text>
                    </View>
                </View>
                <View style={styles.settingValue}>
                    <Text style={styles.valueText}>{getMessagePrivacyDisplayName(allowMessagesFrom)}</Text>
                    <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                </View>
            </TouchableOpacity>

            <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                    <OxyIcon name="activity" size={20} color="#5856D6" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Show Activity Status</Text>
                        <Text style={styles.settingDescription}>Share your recent activity</Text>
                    </View>
                </View>
                <Switch
                    value={showActivityStatus}
                    onValueChange={onToggleActivityStatus}
                    trackColor={{ false: '#E5E5EA', true: '#007AFF' }}
                    thumbColor={showActivityStatus ? '#fff' : '#fff'}
                />
            </View>

            <TouchableOpacity
                style={styles.settingItem}
                onPress={onBlockedUsers}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="person-slash" size={20} color="#FF3B30" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Blocked Users</Text>
                        <Text style={styles.settingDescription}>Manage blocked accounts</Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.settingItem, styles.lastSettingItem]}
                onPress={onDataExport}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="download" size={20} color="#8E8E93" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Export Data</Text>
                        <Text style={styles.settingDescription}>Download your account data</Text>
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
    valueText: {
        fontSize: 14,
        color: '#007AFF',
        marginRight: 8,
        fontWeight: '500',
    },
});

export default React.memo(PrivacySection); 