import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export interface EmptyStateProps {
    message: string;
    textColor?: string;
}

/**
 * Reusable empty state component
 * Provides consistent empty state displays across screens
 */
const EmptyState: React.FC<EmptyStateProps> = ({
    message,
    textColor,
}) => {
    return (
        <View style={styles.container}>
            <Text style={[styles.message, textColor ? { color: textColor } : undefined]}>
                {message}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        padding: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    message: {
        fontSize: 16,
        textAlign: 'center',
    },
});

export default React.memo(EmptyState);

