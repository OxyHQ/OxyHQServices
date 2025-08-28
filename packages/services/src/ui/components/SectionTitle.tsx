import type React from 'react';
import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { fontFamilies } from '../styles/fonts';

interface SectionTitleProps {
    title: string;
    theme: 'light' | 'dark';
    style?: StyleProp<TextStyle>;
}

const SectionTitle: React.FC<SectionTitleProps> = ({ title, theme, style }) => {
    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';

    return (
        <Text style={[styles.sectionTitle, { color: textColor }, style]}>
            {title}
        </Text>
    );
};

const styles = StyleSheet.create({
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 12,
    },
});

export default SectionTitle;
