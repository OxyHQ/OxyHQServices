import type React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface GroupedItemProps {
    icon?: string;
    iconColor?: string;
    image?: string;
    imageSize?: number;
    title: string;
    subtitle?: string;
    theme: 'light' | 'dark';
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
    dense?: boolean; // reduces internal padding
}

const GroupedItem: React.FC<GroupedItemProps> = ({
    icon,
    iconColor = '#007AFF',
    image,
    imageSize = 20,
    title,
    subtitle,
    theme,
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
}) => {
    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const secondaryBackgroundColor = isDarkTheme ? '#1C1C1E' : '#FFFFFF';
    const selectedBackgroundColor = selected ? `${iconColor}15` : secondaryBackgroundColor;

    const itemStyles = [
        styles.groupedItem,
        isFirst && styles.firstGroupedItem,
        isLast && styles.lastGroupedItem,
        {
            backgroundColor: selected ? selectedBackgroundColor : secondaryBackgroundColor,
        },
    ];

    const content = (
        <View style={[
            styles.groupedItemContent,
            multiRow && styles.groupedItemContentMultiRow,
            dense && styles.groupedItemContentDense,
        ]}>
            {customIcon ? (
                <View style={styles.actionIcon}>
                    {customIcon}
                </View>
            ) : image ? (
                <Image
                    source={{ uri: image }}
                    style={[styles.actionImage, { width: imageSize, height: imageSize }]}
                />
            ) : icon ? (
                <View style={[styles.iconContainer, { backgroundColor: `${iconColor}20` }]}>
                    <Ionicons name={icon as any} size={20} color={iconColor} />
                </View>
            ) : null}
            <View style={[styles.actionTextContainer, multiRow && styles.actionTextContainerMultiRow]}>
                <Text style={[styles.actionButtonText, { color: textColor }]}>{title}</Text>
                {subtitle && (
                    <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#98989D' : '#8E8E93' }]}>
                        {subtitle}
                    </Text>
                )}
                {customContentBelow}
            </View>
            {customContent}
            {selected ? (
                <Ionicons name="checkmark-circle" size={20} color={iconColor || '#007AFF'} />
            ) : showChevron ? (
                <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#636366' : '#C7C7CC'} />
            ) : null}
        </View>
    );

    if (onPress && !disabled) {
        return (
            <TouchableOpacity style={itemStyles} onPress={onPress}>
                {content}
            </TouchableOpacity>
        );
    }

    return (
        <View style={itemStyles}>
            {content}
        </View>
    );
};

const styles = StyleSheet.create({
    groupedItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: StyleSheet.hairlineWidth,
        overflow: 'hidden',
        width: '100%',
    },
    firstGroupedItem: {
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    lastGroupedItem: {
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        marginBottom: 0,
    },
    groupedItemContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        width: '100%',
    },
    groupedItemContentDense: {
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    actionIcon: {
        marginRight: 12,
    },
    iconContainer: {
        width: 32,
        height: 32,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    actionImage: {
        marginRight: 12,
        borderRadius: 12,
    },
    actionTextContainer: {
        flex: 1,
    },
    actionButtonText: {
        fontSize: 17,
        fontWeight: '400',
        marginBottom: 2,
        letterSpacing: -0.2,
    },
    actionButtonSubtext: {
        fontSize: 15,
        lineHeight: 20,
        marginTop: 1,
    },
    groupedItemContentMultiRow: {
        alignItems: 'flex-start',
        paddingVertical: 12,
    },
    actionTextContainerMultiRow: {
        alignItems: 'flex-start',
    },
});

export default GroupedItem;
