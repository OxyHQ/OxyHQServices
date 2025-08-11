import type React from 'react';
import { View } from 'react-native';
import GroupedItem from './GroupedItem';

interface GroupedSectionItem {
    id: string;
    icon?: string;
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
}

interface GroupedSectionProps {
    items: GroupedSectionItem[];
    theme: 'light' | 'dark';
}

const GroupedSection: React.FC<GroupedSectionProps> = ({ items, theme }) => {
    return (
        <View style={{ width: '100%' }}>
            {items.map((item, index) => (
                <GroupedItem
                    key={item.id}
                    icon={item.icon}
                    iconColor={item.iconColor}
                    image={item.image}
                    imageSize={item.imageSize}
                    title={item.title}
                    subtitle={item.subtitle}
                    theme={theme}
                    onPress={item.onPress}
                    isFirst={index === 0}
                    isLast={index === items.length - 1}
                    showChevron={item.showChevron}
                    disabled={item.disabled}
                    selected={item.selected}
                    customContent={item.customContent}
                    customIcon={item.customIcon}
                    multiRow={item.multiRow}
                    dense={item.dense}
                    customContentBelow={item.customContentBelow}
                />
            ))}
        </View>
    );
};

export default GroupedSection;
