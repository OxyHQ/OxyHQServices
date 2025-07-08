import React from 'react';
import { View, Text, Animated, TouchableOpacity } from 'react-native';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';

interface SignUpSummaryStepProps {
    styles: any;
    fadeAnim: Animated.Value;
    slideAnim: Animated.Value;
    colors: any;
    formData: any;
    isLoading: boolean;
    handleSignUp: () => void;
    prevStep: () => void;
}

const SignUpSummaryStep: React.FC<SignUpSummaryStepProps> = ({
    styles,
    fadeAnim,
    slideAnim,
    colors,
    formData,
    isLoading,
    handleSignUp,
    prevStep,
}) => (
    <Animated.View style={[
        styles.stepContainer,
        { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
    ]}>
        <View style={styles.modernHeader}>
            <Text style={[styles.stepTitle, { color: colors.text }]}>Ready to join</Text>
        </View>
        <View style={styles.summaryContainer}>
            <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Username:</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{formData.username}</Text>
            </View>
            <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Email:</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{formData.email}</Text>
            </View>
        </View>
        <GroupedPillButtons
            buttons={[
                {
                    text: 'Back',
                    onPress: prevStep,
                    icon: 'arrow-back',
                    variant: 'transparent',
                },
                {
                    text: 'Create Account',
                    onPress: handleSignUp,
                    icon: 'checkmark',
                    variant: 'primary',
                    disabled: isLoading,
                    loading: isLoading,
                    testID: 'signup-button',
                },
            ]}
            colors={colors}
        />
    </Animated.View>
);

export default SignUpSummaryStep; 