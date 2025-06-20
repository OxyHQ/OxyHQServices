import React, { useState, useCallback } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface PasswordInputProps extends Omit<TextInputProps, 'secureTextEntry'> {
    iconColor?: string;
    containerStyle?: any;
}

const PasswordInput: React.FC<PasswordInputProps> = React.memo(({
    value,
    onChangeText,
    iconColor = '#888',
    style,
    containerStyle,
    ...rest
}) => {
    const [visible, setVisible] = useState(false);

    const toggleVisibility = useCallback(() => {
        setVisible(v => !v);
    }, []);

    return (
        <View style={[styles.container, containerStyle]}>
            <TextInput
                {...rest}
                value={value}
                onChangeText={onChangeText}
                secureTextEntry={!visible}
                style={[styles.input, style]}
            />
            <TouchableOpacity onPress={toggleVisibility} style={styles.toggle}>
                <Ionicons name={visible ? 'eye-off' : 'eye'} size={20} color={iconColor} />
            </TouchableOpacity>
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        position: 'relative',
        width: '100%',
    },
    input: {
        paddingRight: 32,
        flex: 1,
    },
    toggle: {
        position: 'absolute',
        right: 8,
        top: 12,
        padding: 4,
    },
});

export default PasswordInput;
