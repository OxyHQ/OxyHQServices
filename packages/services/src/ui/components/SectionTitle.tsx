import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { fontFamilies } from '../styles/fonts';

interface SectionTitleProps {
    title: string;
    theme: 'light' | 'dark';
    style?: any;
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
