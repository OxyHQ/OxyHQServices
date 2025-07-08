import React from 'react';
import { View, Text, Animated } from 'react-native';
import HighFive from '../../../assets/illustrations/HighFive';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';

interface SignUpWelcomeStepProps {
    styles: any;
    fadeAnim: Animated.Value;
    slideAnim: Animated.Value;
    colors: any;
    nextStep: () => void;
    navigate: any;
}

const SignUpWelcomeStep: React.FC<SignUpWelcomeStepProps> = ({
    styles,
    fadeAnim,
    slideAnim,
    colors,
    nextStep,
    navigate,
}) => (
    <Animated.View style={[
        styles.stepContainer,
        { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
    ]}>
        <HighFive width={100} height={100} />
        <View style={styles.modernHeader}>
            <Text style={[styles.modernTitle, { color: colors.text }]}>Welcome to Oxy</Text>
            <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>We're excited to have you join us. Let's get your account set up in just a few easy steps.</Text>
        </View>
        <GroupedPillButtons
            buttons={[
                {
                    text: 'Sign In',
                    onPress: () => navigate('SignIn'),
                    icon: 'log-in-outline',
                    variant: 'transparent',
                },
                {
                    text: 'Get Started',
                    onPress: nextStep,
                    icon: 'arrow-forward',
                    variant: 'primary',
                },
            ]}
            colors={colors}
        />
    </Animated.View>
);

export default SignUpWelcomeStep; 