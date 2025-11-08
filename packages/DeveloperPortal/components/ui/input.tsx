import React from 'react';
import { TextInput, StyleSheet, View } from 'react-native';
import { ThemedText } from '../themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface InputProps {
    label?: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    helperText?: string;
    error?: string;
    multiline?: boolean;
    numberOfLines?: number;
    keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad' | 'url';
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    secureTextEntry?: boolean;
    disabled?: boolean;
    style?: any;
}

export function Input({
    label,
    value,
    onChangeText,
    placeholder,
    helperText,
    error,
    multiline = false,
    numberOfLines = 1,
    keyboardType = 'default',
    autoCapitalize = 'sentences',
    secureTextEntry = false,
    disabled = false,
    style,
}: InputProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const isDark = colorScheme === 'dark';

    return (
        <View style={[styles.container, style]}>
            {label && (
                <ThemedText style={styles.label}>{label}</ThemedText>
            )}
            <TextInput
                style={[
                    styles.input,
                    {
                        backgroundColor: colors.inputBackground,
                        borderColor: error ? colors.error : colors.border,
                        color: colors.text,
                    },
                    multiline && styles.multiline,
                    disabled && styles.disabled,
                ]}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={colors.placeholder}
                multiline={multiline}
                numberOfLines={multiline ? numberOfLines : 1}
                keyboardType={keyboardType}
                autoCapitalize={autoCapitalize}
                secureTextEntry={secureTextEntry}
                editable={!disabled}
            />
            {helperText && !error && (
                <ThemedText style={[styles.helperText, { color: colors.icon }]}>
                    {helperText}
                </ThemedText>
            )}
            {error && (
                <ThemedText style={styles.errorText}>{error}</ThemedText>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 20,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 8,
    },
    input: {
        borderRadius: 35, // More rounded like services
        padding: 12,
        paddingHorizontal: 16,
        fontSize: 16,
        borderWidth: 1,
        height: 48, // Match services input height
    },
    multiline: {
        height: 100,
        textAlignVertical: 'top',
        borderRadius: 16, // Less rounded for multiline
    },
    disabled: {
        opacity: 0.5,
    },
    helperText: {
        fontSize: 12,
        marginTop: 4,
        opacity: 0.7,
    },
    errorText: {
        fontSize: 12,
        color: '#FF3B30',
        marginTop: 4,
    },
});
