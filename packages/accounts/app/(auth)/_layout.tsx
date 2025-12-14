import React from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { Slot } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export default function AuthLayout() {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const { width } = useWindowDimensions();
    const isSmallScreen = width < 600;

    const wrapperStyle = isSmallScreen
        ? styles.fullScreenWrapper
        : [styles.centeredWrapper, { borderColor: colors.border, backgroundColor: colors.card }];

    return (
        <View style={[styles.container, { backgroundColor: colors.background }, !isSmallScreen && styles.centeredContainer]}>
            <View style={[styles.wrapper, wrapperStyle]}>
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                >
                    <Slot />
                </ScrollView>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    centeredContainer: {
    },
    wrapper: {
        width: '100%',
    },
    fullScreenWrapper: {
        flex: 1,
    },
    centeredWrapper: {
        maxWidth: 600,
        borderRadius: 16,
        borderWidth: 1,
    },
    scrollView: {
        flex: 1,
        width: '100%',
        paddingHorizontal: 20,
        paddingVertical: 60,
    },
    scrollContent: {
        flexGrow: 1,
    },
});
