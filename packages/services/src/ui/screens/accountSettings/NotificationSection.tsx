import React from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { toast } from '../../../lib/sonner';
import OxyIcon from '../../components/icon/OxyIcon';
import { fontFamilies } from '../../styles/fonts';

interface NotificationSectionProps {
    pushNotifications: boolean;
    emailNotifications: boolean;
    marketingEmails: boolean;
    soundEnabled: boolean;
    onTogglePushNotifications: (value: boolean) => void;
    onToggleEmailNotifications: (value: boolean) => void;
    onToggleMarketingEmails: (value: boolean) => void;
    onToggleSound: (value: boolean) => void;
    onNotificationPreferences: () => void;
}

const NotificationSection: React.FC<NotificationSectionProps> = ({
    pushNotifications,
    emailNotifications,
    marketingEmails,
    soundEnabled,
    onTogglePushNotifications,
    onToggleEmailNotifications,
    onToggleMarketingEmails,
    onToggleSound,
    onNotificationPreferences,
}) => {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notifications</Text>

            <View style={[styles.settingItem, styles.firstSettingItem]}>
                <View style={styles.settingInfo}>
                    <OxyIcon name="notifications" size={20} color="#007AFF" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Push Notifications</Text>
                        <Text style={styles.settingDescription}>Receive notifications on your device</Text>
                    </View>
                </View>
                <Switch
                    value={pushNotifications}
                    onValueChange={onTogglePushNotifications}
                    trackColor={{ false: '#E5E5EA', true: '#007AFF' }}
                    thumbColor={pushNotifications ? '#fff' : '#fff'}
                />
            </View>

            <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                    <OxyIcon name="mail" size={20} color="#FF9500" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Email Notifications</Text>
                        <Text style={styles.settingDescription}>Receive important updates via email</Text>
                    </View>
                </View>
                <Switch
                    value={emailNotifications}
                    onValueChange={onToggleEmailNotifications}
                    trackColor={{ false: '#E5E5EA', true: '#007AFF' }}
                    thumbColor={emailNotifications ? '#fff' : '#fff'}
                />
            </View>

            <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                    <OxyIcon name="megaphone" size={20} color="#5856D6" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Marketing Emails</Text>
                        <Text style={styles.settingDescription}>Receive updates about new features</Text>
                    </View>
                </View>
                <Switch
                    value={marketingEmails}
                    onValueChange={onToggleMarketingEmails}
                    trackColor={{ false: '#E5E5EA', true: '#007AFF' }}
                    thumbColor={marketingEmails ? '#fff' : '#fff'}
                />
            </View>

            <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                    <OxyIcon name="volume-high" size={20} color="#30D158" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Sound</Text>
                        <Text style={styles.settingDescription}>Play sounds for notifications</Text>
                    </View>
                </View>
                <Switch
                    value={soundEnabled}
                    onValueChange={onToggleSound}
                    trackColor={{ false: '#E5E5EA', true: '#007AFF' }}
                    thumbColor={soundEnabled ? '#fff' : '#fff'}
                />
            </View>

            <TouchableOpacity
                style={[styles.settingItem, styles.lastSettingItem]}
                onPress={onNotificationPreferences}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="settings" size={20} color="#8E8E93" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Notification Preferences</Text>
                        <Text style={styles.settingDescription}>Customize notification types</Text>
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
});

export default React.memo(NotificationSection); 