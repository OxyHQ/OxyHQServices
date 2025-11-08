import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface GroupedItemProps {
    icon?: keyof typeof Ionicons.glyphMap;
    iconColor?: string;
    image?: string;
    imageSize?: number;
    title: string;
    subtitle?: string;
    onPress?: () => void;
    isFirst?: boolean;
    isLast?: boolean;
    showChevron?: boolean;
    disabled?: boolean;
    selected?: boolean;
    customContent?: React.ReactNode;
    customIcon?: React.ReactNode;
    multiRow?: boolean;
    customContentBelow?: React.ReactNode;
    dense?: boolean;
}

export function GroupedItem({
    icon,
    iconColor = '#d169e5',
    image,
    imageSize = 20,
    title,
    subtitle,
    onPress,
    isFirst = false,
    isLast = false,
    showChevron = true,
    disabled = false,
    selected = false,
    customContent,
    customIcon,
    multiRow = false,
    customContentBelow,
    dense = false,
}: GroupedItemProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const isDark = colorScheme === 'dark';

    const selectedBackgroundColor = selected ? `${iconColor}15` : colors.card;

    const itemStyles = [
        styles.groupedItem,
        isFirst && styles.firstGroupedItem,
        isLast && styles.lastGroupedItem,
        {
            backgroundColor: selected ? selectedBackgroundColor : colors.card,
        },
    ];

    const content = (
        <View
            style={[
                styles.groupedItemContent,
                multiRow && styles.groupedItemContentMultiRow,
                dense && styles.groupedItemContentDense,
            ]}
        >
            {customIcon ? (
                <View style={styles.actionIcon}>{customIcon}</View>
            ) : image ? (
                <Image
                    source={{ uri: image }}
                    style={[styles.actionImage, { width: imageSize, height: imageSize }]}
                />
            ) : icon ? (
                <View style={[styles.iconContainer, { backgroundColor: `${iconColor}20` }]}>
                    <Ionicons name={icon} size={20} color={iconColor} />
                </View>
            ) : null}
            <View style={[styles.actionTextContainer, multiRow && styles.actionTextContainerMultiRow]}>
                <Text style={[styles.actionButtonText, { color: colors.text }]}>{title}</Text>
                {subtitle && (
                    <Text style={[styles.actionButtonSubtext, { color: colors.secondaryText }]}>
                        {subtitle}
                    </Text>
                )}
                {customContentBelow}
            </View>
            {customContent}
            {selected ? (
                <Ionicons name="checkmark-circle" size={20} color={iconColor} />
            ) : showChevron ? (
                <Ionicons name="chevron-forward" size={16} color={colors.icon} />
            ) : null}
        </View>
    );

    if (onPress && !disabled) {
        return (
            <TouchableOpacity style={itemStyles} onPress={onPress} activeOpacity={0.7}>
                {content}
            </TouchableOpacity>
        );
    }

    return <View style={itemStyles}>{content}</View>;
}

const styles = StyleSheet.create({
    groupedItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
        overflow: 'hidden',
        width: '100%',
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
    groupedItemContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 12,
        width: '100%',
    },
    groupedItemContentDense: {
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    actionIcon: {
        marginRight: 12,
    },
    iconContainer: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    actionImage: {
        marginRight: 12,
        borderRadius: 16,
    },
    actionTextContainer: {
        flex: 1,
    },
    actionButtonText: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 2,
    },
    actionButtonSubtext: {
        fontSize: 13,
        lineHeight: 18,
    },
    groupedItemContentMultiRow: {
        alignItems: 'flex-start',
        paddingVertical: 12,
    },
    actionTextContainerMultiRow: {
        alignItems: 'flex-start',
    },
});
