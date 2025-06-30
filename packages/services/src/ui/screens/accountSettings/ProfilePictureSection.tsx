import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Avatar from '../../components/Avatar';
import OxyIcon from '../../components/icon/OxyIcon';
import { fontFamilies } from '../../styles/fonts';

interface ProfilePictureSectionProps {
    avatarUrl: string;
    displayName: string;
    username: string;
    theme: 'light' | 'dark';
    onUpdateAvatar: () => void;
}

const ProfilePictureSection: React.FC<ProfilePictureSectionProps> = ({
    avatarUrl,
    displayName,
    username,
    theme,
    onUpdateAvatar,
}) => {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profile Picture</Text>

            <TouchableOpacity
                style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}
                onPress={onUpdateAvatar}
            >
                <View style={styles.userIcon}>
                    <Avatar uri={avatarUrl} name={displayName || username} size={50} theme={theme} />
                </View>
                <View style={styles.settingInfo}>
                    <View>
                        <Text style={styles.settingLabel}>Profile Photo</Text>
                        <Text style={styles.settingDescription}>
                            {avatarUrl ? 'Tap to change your profile picture' : 'Tap to add a profile picture'}
                        </Text>
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
    settingLabel: { fontSize: 16, fontWeight: '500', color: '#333', marginBottom: 2 },
    settingDescription: { fontSize: 14, color: '#666' },
    userIcon: { marginRight: 12 },
});

export default React.memo(ProfilePictureSection); 