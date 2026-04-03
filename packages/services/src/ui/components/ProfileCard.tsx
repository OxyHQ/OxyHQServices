import type React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';
import { useI18n } from '../hooks/useI18n';
import Avatar from './Avatar';
import { useOxy } from '../context/OxyContext';
import { useFileDownloadUrl } from '../hooks';
import { fontFamilies } from '../styles/fonts';

interface ProfileCardProps {
    user: {
        username: string;
        email?: string;
        name?: { full?: string };
        avatar?: string; // file id
    };
    theme: 'light' | 'dark';
    onEditPress?: () => void;
    onClosePress?: () => void;
    showCloseButton?: boolean;
}

const ProfileCard: React.FC<ProfileCardProps> = ({
    user,
    theme,
    onEditPress,
    onClosePress,
    showCloseButton = false,
}) => {
    const { colors } = useTheme();
    const { oxyServices } = useOxy();
    const { t } = useI18n();

    const avatarUrl = useFileDownloadUrl(oxyServices, user?.avatar, { variant: 'thumb' }).url || undefined;

    return (
        <View style={styles.headerSection}>
            <View
                className="bg-secondary"
                style={[
                    styles.profileCard,
                    styles.firstGroupedItem,
                    styles.lastGroupedItem,
                ]}
            >
                <View style={styles.userProfile}>
                    <Avatar
                        uri={user?.avatar ? avatarUrl : undefined}
                        name={user?.name?.full || user?.username}
                        size={60}
                        theme={theme}
                    />
                    <View style={styles.userInfo}>
                        <Text className="text-foreground" style={styles.userName}>{user.username}</Text>
                        {user.email && (
                            <Text className="text-muted-foreground" style={styles.userEmail}>
                                {user.email}
                            </Text>
                        )}
                        {onEditPress && (
                            <TouchableOpacity
                                style={styles.editProfileButton}
                                onPress={onEditPress}
                            >
                                <Text className="text-primary" style={styles.editProfileText}>
                                    {t('editProfile.title') || 'Edit Profile'}
                                </Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
                {showCloseButton && onClosePress && (
                    <TouchableOpacity style={styles.closeButton} onPress={onClosePress}>
                        <Ionicons name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    headerSection: {
        padding: 16,
        paddingTop: 20,
    },
    profileCard: {
        padding: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    firstGroupedItem: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    lastGroupedItem: {
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 8,
    },
    userProfile: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    userInfo: {
        marginLeft: 16,
        flex: 1,
    },
    userName: {
        fontSize: 22,
        fontWeight: 'bold',
        fontFamily: fontFamilies.interBold,
        marginBottom: 4,
    },
    userEmail: {
        fontSize: 14,
        marginBottom: 8,
    },
    editProfileButton: {
        alignSelf: 'flex-start',
    },
    editProfileText: {
        fontSize: 14,
        fontWeight: '600',
    },
    closeButton: {
        padding: 8,
    },
});

export default ProfileCard;
