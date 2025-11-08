import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { GroupedItem } from './grouped-item';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface SubItem {
    id: string;
    title: string;
    description?: string;
    onPress?: () => void;
    selected?: boolean;
}

interface CollapsibleGroupedSectionItem {
    id: string;
    icon?: keyof typeof Ionicons.glyphMap;
    iconColor?: string;
    image?: string;
    imageSize?: number;
    title: string;
    subtitle?: string;
    onPress?: () => void;
    showChevron?: boolean;
    disabled?: boolean;
    selected?: boolean;
    customContent?: React.ReactNode;
    customIcon?: React.ReactNode;
    multiRow?: boolean;
    customContentBelow?: React.ReactNode;
    dense?: boolean;
    subItems?: SubItem[];
    defaultExpanded?: boolean;
}

interface CollapsibleGroupedSectionProps {
    items: CollapsibleGroupedSectionItem[];
}

export function CollapsibleGroupedSection({ items }: CollapsibleGroupedSectionProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const [expandedItems, setExpandedItems] = useState<Set<string>>(
        new Set(items.filter(item => item.defaultExpanded).map(item => item.id))
    );

    const toggleExpanded = (itemId: string) => {
        setExpandedItems(prev => {
            const newSet = new Set(prev);
            if (newSet.has(itemId)) {
                newSet.delete(itemId);
            } else {
                newSet.add(itemId);
            }
            return newSet;
        });
    };

    return (
        <View style={{ width: '100%' }}>
            {items.map((item, index) => {
                const hasSubItems = item.subItems && item.subItems.length > 0;
                const isExpanded = expandedItems.has(item.id);
                const isSelected = item.selected || (item.subItems?.some(sub => sub.selected) ?? false);
                const isLastItem = index === items.length - 1;

                // Check if previous item is expanded
                const prevItem = index > 0 ? items[index - 1] : null;
                const prevHasSubItems = prevItem && prevItem.subItems && prevItem.subItems.length > 0;
                const isPrevExpanded = !!(prevItem && prevHasSubItems && expandedItems.has(prevItem.id));

                return (
                    <View key={item.id} style={[isLastItem && styles.lastItemWrapper, isPrevExpanded && styles.itemAfterExpanded]}>
                        <GroupedItem
                            icon={item.icon}
                            iconColor={item.iconColor}
                            image={item.image}
                            imageSize={item.imageSize}
                            title={item.title}
                            subtitle={item.subtitle}
                            onPress={() => {
                                if (hasSubItems) {
                                    toggleExpanded(item.id);
                                }
                                item.onPress?.();
                            }}
                            isFirst={index === 0 || isPrevExpanded}
                            isLast={isLastItem && !isExpanded}
                            showChevron={!hasSubItems}
                            disabled={item.disabled}
                            selected={isSelected}
                            customContent={
                                hasSubItems ? (
                                    <Ionicons
                                        name={isExpanded ? 'chevron-down' : 'chevron-forward'}
                                        size={16}
                                        color={colors.icon}
                                    />
                                ) : item.customContent
                            }
                            customIcon={item.customIcon}
                            multiRow={item.multiRow}
                            dense={item.dense}
                            customContentBelow={item.customContentBelow}
                        />

                        {/* Render sub-items */}
                        {hasSubItems && isExpanded && (
                            <View style={[styles.subItemsContainer, { backgroundColor: colors.card }]}>
                                {item.subItems!.map((subItem, subIndex) => (
                                    <TouchableOpacity
                                        key={subItem.id}
                                        style={[
                                            styles.subItem,
                                            subItem.selected && { backgroundColor: `${item.iconColor || colors.tint}10` },
                                            subIndex === item.subItems!.length - 1 && styles.lastSubItem,
                                        ]}
                                        onPress={subItem.onPress}
                                        activeOpacity={0.7}
                                    >
                                        <View style={[styles.subItemIndicator, { backgroundColor: colors.border }]} />
                                        <View style={styles.subItemContent}>
                                            <Text
                                                style={[
                                                    styles.subItemTitle,
                                                    { color: subItem.selected ? (item.iconColor || colors.tint) : colors.text },
                                                ]}
                                            >
                                                {subItem.title}
                                            </Text>
                                            {subItem.description && (
                                                <Text style={[styles.subItemDescription, { color: colors.secondaryText }]}>
                                                    {subItem.description}
                                                </Text>
                                            )}
                                        </View>
                                        {subItem.selected && (
                                            <Ionicons
                                                name="checkmark-circle"
                                                size={16}
                                                color={item.iconColor || colors.tint}
                                            />
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    lastItemWrapper: {
        marginBottom: 8,
    },
    itemAfterExpanded: {
        marginTop: 8,
    },
    subItemsContainer: {
        paddingLeft: 12,
        paddingRight: 12,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        overflow: 'hidden',
        marginTop: -2,
    },
    subItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 12,
        paddingLeft: 38,
    },
    lastSubItem: {
        paddingBottom: 12,
    },
    subItemIndicator: {
        width: 2,
        height: 20,
        marginRight: 12,
        borderRadius: 1,
    },
    subItemContent: {
        flex: 1,
    },
    subItemTitle: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 2,
    },
    subItemDescription: {
        fontSize: 12,
        lineHeight: 16,
    },
});
