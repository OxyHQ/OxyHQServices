import type React from 'react';
import { memo, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';
import { darkenColor } from '../utils/colorUtils';


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
    /** Accessibility label (defaults to title) */
    accessibilityLabel?: string;
    /** Accessibility hint for what happens on press */
    accessibilityHint?: string;
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
    accessibilityLabel,
    accessibilityHint,
}: GroupedItemProps) => {
    const { colors } = useTheme();
    // Use fallback color when iconColor is not provided
    const finalIconColor = iconColor || colors.icon;

    const itemStyles = useMemo(
        () => [
            styles.groupedItem,
            isFirst && styles.firstGroupedItem,
            isLast && styles.lastGroupedItem,
        ],
        [isFirst, isLast],
    );

    const content = (
        <View style={styles.groupedItemContent}>
            {customIcon ? (
                <View style={styles.actionIcon}>{customIcon}</View>
            ) : icon ? (
                <View style={[styles.iconContainer, { backgroundColor: finalIconColor }]}>
                    <MaterialCommunityIcons name={icon} size={22} color={darkenColor(finalIconColor)} />
                </View>
            ) : null}
            <View style={styles.actionTextContainer}>
                <Text className="text-foreground" style={styles.actionButtonText}>{title}</Text>
                {subtitle && (
                    <Text className="text-muted-foreground" style={styles.actionButtonSubtext}>
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

    if (onPress && !disabled) {
        return (
            <TouchableOpacity
                className="bg-card"
                style={itemStyles}
                onPress={onPress}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel || title}
                accessibilityHint={accessibilityHint || subtitle}
                accessibilityState={{ disabled }}
            >
                {content}
            </TouchableOpacity>
        );
    }

    return (
        <View
            className="bg-card"
            style={itemStyles}
            accessibilityRole="text"
            accessibilityLabel={accessibilityLabel || title}
        >
            {content}
        </View>
    );
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
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
    },
    lastGroupedItem: {
        borderBottomLeftRadius: 18,
        borderBottomRightRadius: 18,
    },
    groupedItemContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 10,
        width: '100%',
        gap: 10,
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
        fontSize: 14,
        fontWeight: '400',
    },
    actionButtonSubtext: {
        fontSize: 12,
        marginTop: 2,
    },
});

export default GroupedItem;
