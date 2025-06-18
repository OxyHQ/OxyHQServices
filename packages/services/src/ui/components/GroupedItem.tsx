import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface GroupedItemProps {
    icon?: string;
    iconColor?: string;
    title: string;
    subtitle?: string;
    theme: 'light' | 'dark';
    onPress?: () => void;
    isFirst?: boolean;
    isLast?: boolean;
    showChevron?: boolean;
    disabled?: boolean;
    customContent?: React.ReactNode;
}

const GroupedItem: React.FC<GroupedItemProps> = ({
    icon,
    iconColor = '#007AFF',
    title,
    subtitle,
    theme,
    onPress,
    isFirst = false,
    isLast = false,
    showChevron = true,
    disabled = false,
    customContent,
}) => {
    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#FFFFFF';

    const itemStyles = [
        styles.groupedItem,
        isFirst && styles.firstGroupedItem,
        isLast && styles.lastGroupedItem,
        { backgroundColor: secondaryBackgroundColor },
    ];

    const content = (
        <View style={styles.groupedItemContent}>
            {icon && (
                <Ionicons name={icon as any} size={20} color={iconColor} style={styles.actionIcon} />
            )}
            <View style={styles.actionTextContainer}>
                <Text style={[styles.actionButtonText, { color: textColor }]}>{title}</Text>
                {subtitle && (
                    <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                        {subtitle}
                    </Text>
                )}
            </View>
            {customContent}
            {showChevron && (
                <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#666666' : '#999999'} />
            )}
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
        marginBottom: 2,
        overflow: 'hidden',
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
        padding: 16,
        width: '100%',
    },
    actionIcon: {
        marginRight: 12,
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
});

export default GroupedItem;
