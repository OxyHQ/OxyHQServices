import React from 'react';
import { View } from 'react-native';
import GroupedItem from './GroupedItem';

interface GroupedSectionItem {
    id: string;
    icon?: string;
    iconColor?: string;
    title: string;
    subtitle?: string;
    onPress?: () => void;
    showChevron?: boolean;
    disabled?: boolean;
    customContent?: React.ReactNode;
}

interface GroupedSectionProps {
    items: GroupedSectionItem[];
    theme: 'light' | 'dark';
}

const GroupedSection: React.FC<GroupedSectionProps> = ({ items, theme }) => {
    return (
        <View>
            {items.map((item, index) => (
                <GroupedItem
                    key={item.id}
                    icon={item.icon}
                    iconColor={item.iconColor}
                    title={item.title}
                    subtitle={item.subtitle}
                    theme={theme}
                    onPress={item.onPress}
                    isFirst={index === 0}
                    isLast={index === items.length - 1}
                    showChevron={item.showChevron}
                    disabled={item.disabled}
                    customContent={item.customContent}
                />
            ))}
        </View>
    );
};

export default GroupedSection;
