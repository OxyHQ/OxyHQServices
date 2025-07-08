import React from 'react';
import { View, Text, Animated, TouchableOpacity } from 'react-native';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';
import HighFive from '../../../assets/illustrations/HighFive';

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
    handleIdentityNext,
    ValidationMessage,
    validateEmail,
    navigate,
}) => (
    <Animated.View style={[
        styles.stepContainer,
        { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
    ]}>
        <View style={styles.modernHeader}>
            <Text style={[styles.stepTitle, { color: colors.text }]}>Who are you?</Text>
        </View>
        <TextField
            icon="person-outline"
            label="Username"
            value={formData.username}
            onChangeText={(text) => {
                updateField('username', text);
                setErrorMessage('');
            }}
            autoCapitalize="none"
            autoCorrect={false}
            testID="username-input"
            colors={colors}
            variant="filled"
            error={validationState.status === 'invalid' ? validationState.message : undefined}
            loading={validationState.status === 'validating'}
            success={validationState.status === 'valid'}
        />
        <ValidationMessage validationState={validationState} colors={colors} styles={styles} />
        <TextField
            icon="mail-outline"
            label="Email"
            value={formData.email}
            onChangeText={(text) => {
                updateField('email', text);
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            testID="email-input"
            colors={colors}
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

export default SignUpIdentityStep; 