import type React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import SectionTitle from './SectionTitle';

interface SectionProps {
    title?: string;
    theme: 'light' | 'dark';
    children: React.ReactNode;
    isFirst?: boolean;
    style?: StyleProp<ViewStyle>;
}

const Section: React.FC<SectionProps> = ({
    title,
    theme,
    children,
    isFirst = false,
    style
}) => {
    return (
        <View style={[styles.section, isFirst && styles.firstSection, style]}>
            {title && <SectionTitle title={title} theme={theme} />}
            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    section: {
        marginBottom: 24,
    },
    firstSection: {
        marginTop: 8,
    },
});

export default Section;
