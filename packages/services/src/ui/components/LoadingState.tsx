import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';

export interface LoadingStateProps {
    message?: string;
    color?: string;
    size?: 'small' | 'large';
}

/**
 * Reusable loading state component
 * Provides consistent loading indicators across screens
 */
const LoadingState: React.FC<LoadingStateProps> = ({
    message,
    color,
    size = 'large',
}) => {
    return (
        <View style={styles.container}>
            <ActivityIndicator size={size} color={color} />
            {message && (
                <Text style={[styles.message, color ? { color } : undefined]}>
                    {message}
                </Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        gap: 12,
    },
    message: {
        marginTop: 12,
        fontSize: 16,
        textAlign: 'center',
    },
});

export default React.memo(LoadingState);

