import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { toast } from '../../../lib/sonner';
import OxyIcon from '../../components/icon/OxyIcon';
import { fontFamilies } from '../../styles/fonts';

const QuickActionsSection: React.FC = () => {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>

            <TouchableOpacity
                style={[styles.settingItem, styles.firstSettingItem]}
                onPress={() => toast.info('Privacy settings coming soon!')}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="shield-checkmark" size={20} color="#8E8E93" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Privacy Settings</Text>
                        <Text style={styles.settingDescription}>Control who can see your profile</Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.settingItem, styles.lastSettingItem]}
                onPress={() => toast.info('Account verification coming soon!')}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="checkmark-circle" size={20} color="#30D158" style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>Verify Account</Text>
                        <Text style={styles.settingDescription}>Get a verified badge</Text>
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

export default React.memo(QuickActionsSection); 