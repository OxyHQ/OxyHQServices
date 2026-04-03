import type React from 'react';
import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { fontFamilies } from '../styles/fonts';

interface SectionTitleProps {
    title: string;
    theme?: 'light' | 'dark';
    style?: StyleProp<TextStyle>;
}

const SectionTitle: React.FC<SectionTitleProps> = ({ title, theme, style }) => {
    return (
        <Text className="text-foreground" style={[styles.sectionTitle, style]}>
            {title}
        </Text>
    );
};

const styles = StyleSheet.create({
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.interSemiBold,
    },
});

export default SectionTitle;
