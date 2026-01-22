import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FeedbackColors } from './types';

interface FormInputProps {
    icon: string;
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    multiline?: boolean;
    numberOfLines?: number;
    testID?: string;
    colors: FeedbackColors;
    styles: any;
    borderColor?: string;
    accessibilityLabel?: string;
    accessibilityHint?: string;
}

const FormInput: React.FC<FormInputProps> = React.memo(({
    icon,
    label,
    value,
    onChangeText,
    placeholder,
    multiline = false,
    numberOfLines = 1,
    testID,
    colors,
    styles,
    borderColor,
    accessibilityLabel,
    accessibilityHint,
}) => (
    <View style={styles.inputContainer}>
        <View style={[
            multiline ? styles.textAreaWrapper : styles.premiumInputWrapper,
            {
                borderColor: borderColor || colors.border,
                backgroundColor: colors.inputBackground,
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
                elevation: 3,
            }
        ]}>
            {!multiline && (
                <Ionicons
                    name={icon as any}
                    size={22}
                    color={colors.secondaryText}
                    style={styles.inputIcon}
                />
            )}
            <View style={styles.inputContent}>
                <Text style={[styles.modernLabel, { color: colors.secondaryText }]}>
                    {label}
                </Text>
                <TextInput
                    style={[
                        multiline ? styles.textArea : styles.modernInput,
                        { color: colors.text }
                    ]}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={colors.secondaryText + '60'}
                    multiline={multiline}
                    numberOfLines={multiline ? numberOfLines : undefined}
                    testID={testID}
                    accessibilityLabel={accessibilityLabel || label}
                    accessibilityHint={accessibilityHint}
                />
            </View>
        </View>
    </View>
));

FormInput.displayName = 'FormInput';

export default FormInput;
