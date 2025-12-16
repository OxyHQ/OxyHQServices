import React from 'react';
import { View, StyleSheet, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { ThemedText } from './themed-text';

interface SectionProps {
    title?: string;
    children: React.ReactNode;
    isFirst?: boolean;
    style?: StyleProp<ViewStyle>;
}

export function Section({ title, children, isFirst = false, style }: SectionProps) {
    // Check if first child is a description (ThemedText with sectionSubtitle style)
    const childrenArray = React.Children.toArray(children);
    const firstChild = childrenArray[0];
    
    // Helper to check if a style matches sectionSubtitle (fontSize 14, opacity 0.7)
    const isSectionSubtitleStyle = (styleObj: any): boolean => {
        if (!styleObj) return false;
        if (Array.isArray(styleObj)) {
            return styleObj.some(isSectionSubtitleStyle);
        }
        // Check for fontSize 14 and opacity 0.7 (sectionSubtitle characteristics)
        return styleObj.fontSize === 14 && styleObj.opacity === 0.7;
    };
    
    const isFirstChildDescription = React.isValidElement(firstChild) && 
        firstChild.type === ThemedText && 
        isSectionSubtitleStyle(firstChild.props.style);

    const description = isFirstChildDescription ? firstChild : null;
    const content = isFirstChildDescription ? childrenArray.slice(1) : childrenArray;

    return (
        <View style={[styles.section, isFirst && styles.firstSection, style]}>
            {(title || description) && (
                <View style={styles.headerContainer}>
                    {title && (
                        <ThemedText style={styles.sectionTitle}>
                            {title}
                        </ThemedText>
                    )}
                    {description}
                </View>
            )}
            {content.length > 0 && (
                <View style={styles.contentContainer}>
                    {content}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        marginBottom: 24,
        gap: 12,
    },
    firstSection: {
        marginTop: 0,
    },
    headerContainer: {
        gap: 2,
    },
    contentContainer: {
        gap: 0,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: Platform.OS === 'web' ? '600' : undefined,
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-SemiBold',
    },
});
