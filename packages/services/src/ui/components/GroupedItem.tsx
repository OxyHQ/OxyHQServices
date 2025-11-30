import React, { memo, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useColorScheme } from '../hooks/use-color-scheme';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useHapticPress } from '../hooks/use-haptic-press';
import { darkenColor } from '../utils/colorUtils';
import { normalizeColorScheme } from '../utils/themeUtils';

/**
 * Maps Ionicons-style icon names to valid MaterialCommunityIcons names
 */
const mapIconName = (iconName: string): string => {
    const iconMap: Record<string, string> = {
        'person': 'account',
        'person-circle': 'account-circle',
        'person-outline': 'account-outline',
        'person-add': 'account-plus',
        'shield-checkmark': 'shield-check',
        'shield-check': 'shield-check',
        'eye': 'eye',
        'check-circle': 'check-circle',
        'shield-lock': 'shield-lock',
        'notifications': 'bell',
        'people': 'account-group',
        'time': 'clock',
        'time-outline': 'clock-outline',
        'trash': 'delete',
        'trash-outline': 'delete-outline',
        'search': 'magnify',
        'language': 'translate',
        'language-outline': 'translate',
        'settings': 'cog',
        'document-text': 'file-document',
        'information-circle': 'information',
        'information-circle-outline': 'information-outline',
        'log-out': 'logout',
    };

    return iconMap[iconName] || iconName;
};

interface GroupedItemProps {
    icon?: string;
    iconColor?: string;
    title: string;
    subtitle?: string;
    onPress?: () => void;
    isFirst?: boolean;
    isLast?: boolean;
    showChevron?: boolean;
    disabled?: boolean;
    customContent?: React.ReactNode;
    customIcon?: React.ReactNode;
}

const GroupedItemComponent = ({
    icon,
    iconColor,
    title,
    subtitle,
    onPress,
    isFirst = false,
    isLast = false,
    showChevron = false,
    disabled = false,
    customContent,
    customIcon,
}: GroupedItemProps) => {
    const hookColorScheme = useColorScheme();
    const colorScheme = normalizeColorScheme(hookColorScheme);
    const themeStyles = useThemeStyles(colorScheme, hookColorScheme);
    const colors = themeStyles.colors;
    const finalIconColor = iconColor || colors.iconSecurity;

    const itemStyles = useMemo(
        () => [
            styles.groupedItem,
            isFirst && styles.firstGroupedItem,
            isLast && styles.lastGroupedItem,
            {
                backgroundColor: colors.card,
                borderBottomWidth: isLast ? 0 : 1,
                borderBottomColor: colors.border,
            },
        ],
        [colors.border, colors.card, isFirst, isLast],
    );

    const content = (
        <View style={styles.groupedItemContent}>
            {customIcon ? (
                <View style={styles.actionIcon}>{customIcon}</View>
            ) : icon ? (
                <View style={[styles.iconContainer, { backgroundColor: finalIconColor }]}>
                    <MaterialCommunityIcons name={mapIconName(icon) as any} size={22} color={darkenColor(finalIconColor)} />
                </View>
            ) : null}
            <View style={styles.actionTextContainer}>
                <Text style={[styles.actionButtonText, { color: colors.text }]}>{title}</Text>
                {subtitle && (
                    <Text style={[styles.actionButtonSubtext, { color: colors.secondaryText }]}>
                        {subtitle}
                    </Text>
                )}
            </View>
            {customContent}
            {showChevron && (
                <Ionicons name="chevron-forward" size={20} color={colors.icon} />
            )}
        </View>
    );

    const handlePressIn = useHapticPress();

    if (onPress && !disabled) {
        return (
            <TouchableOpacity
                style={itemStyles}
                onPressIn={disabled ? undefined : handlePressIn}
                onPress={onPress}
                activeOpacity={0.7}
            >
                {content}
            </TouchableOpacity>
        );
    }

    return <View style={itemStyles}>{content}</View>;
};

GroupedItemComponent.displayName = 'GroupedItem';

export const GroupedItem = memo(GroupedItemComponent);

const styles = StyleSheet.create({
    groupedItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        overflow: 'hidden',
        width: '100%',
    },
    firstGroupedItem: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    lastGroupedItem: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    groupedItemContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 12,
        width: '100%',
        gap: 12,
    },
    actionIcon: {
        // marginRight handled by gap
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        // marginRight handled by gap
    },
    actionTextContainer: {
        flex: 1,
    },
    actionButtonText: {
        fontSize: 15,
        fontWeight: '400',
    },
    actionButtonSubtext: {
        fontSize: 13,
        marginTop: 2,
    },
});

export default GroupedItem;
