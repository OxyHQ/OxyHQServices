import type React from 'react';
import { useRef } from 'react';
import { View, Text, Animated, TouchableOpacity, type TextInput } from 'react-native';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';
import HighFive from '../../../assets/illustrations/HighFive';
import { Ionicons } from '@expo/vector-icons';

interface SignUpIdentityStepProps {
    styles: any;
    fadeAnim: Animated.Value;
    slideAnim: Animated.Value;
    colors: any;
    formData: any;
    validationState: any;
    updateField: (field: string, value: string) => void;
    setErrorMessage: (msg: string) => void;
    prevStep: () => void;
    handleIdentityNext: () => void;
    ValidationMessage: React.FC<any>;
    validateEmail: (email: string) => boolean;
    navigate: any;
}

const SignUpIdentityStep: React.FC<SignUpIdentityStepProps> = ({
    styles,
    fadeAnim,
    slideAnim,
    colors,
    formData,
    validationState,
    updateField,
    setErrorMessage,
    prevStep,
    handleIdentityNext: parentHandleIdentityNext,
    ValidationMessage,
    validateEmail,
    navigate,
}) => {
    const inputRef = useRef<TextInput>(null);
    const handleIdentityNext = () => {
        if (!formData.username || validationState.status === 'invalid') {
            setTimeout(() => {
                inputRef.current?.focus();
            }, 0);
        }
        parentHandleIdentityNext();
    };
    return (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>Who are you?</Text>
            </View>
            <TextField
                ref={inputRef}
                leading={<Ionicons name="person-outline" size={24} color={colors.secondaryText} />}
                label="Username"
                value={formData.username}
                onChangeText={(text) => {
                    updateField('username', text);
                    setErrorMessage('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                testID="username-input"
                variant="filled"
                error={validationState.status === 'invalid' ? validationState.message : undefined}
                loading={validationState.status === 'validating'}
                success={validationState.status === 'valid'}
                onSubmitEditing={handleIdentityNext}
                autoFocus
            />
            <ValidationMessage validationState={validationState} colors={colors} styles={styles} />
            <TextField
                leading={<Ionicons name="mail-outline" size={24} color={colors.secondaryText} />}
                label="Email"
                value={formData.email}
                onChangeText={(text) => {
                    updateField('email', text);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="email-input"
                variant="filled"
                error={formData.email && !validateEmail(formData.email) ? 'Please enter a valid email address' : undefined}
            />
            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Back',
                        onPress: prevStep,
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: 'Next',
                        onPress: handleIdentityNext,
                        icon: 'arrow-forward',
                        variant: 'primary',
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    );
};

export default SignUpIdentityStep; 