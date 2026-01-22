import React, { useMemo } from 'react';
import { View, Text, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../internal/GroupedPillButtons';
import { createPaymentStyles } from './paymentStyles';
import type { PaymentColors, PaymentStepAnimations } from './types';

interface PaymentSuccessStepProps {
    colors: PaymentColors;
    animations: PaymentStepAnimations;
    onDone: () => void;
}

const PaymentSuccessStep: React.FC<PaymentSuccessStepProps> = ({
    colors,
    animations,
    onDone,
}) => {
    const styles = useMemo(() => createPaymentStyles(colors), [colors]);
    const { fadeAnim, slideAnim, scaleAnim } = animations;

    return (
        <Animated.View
            style={[
                styles.stepContainer,
                {
                    opacity: fadeAnim,
                    transform: [
                        { translateY: slideAnim },
                        { scale: scaleAnim },
                    ],
                },
            ]}
            accessibilityRole="none"
            accessibilityLabel="Payment complete"
        >
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Payment Complete</Text>

                <View style={styles.successCard}>
                    <View style={styles.successContent}>
                        <Ionicons
                            name="checkmark-circle"
                            size={64}
                            color={colors.success || '#4BB543'}
                            style={styles.successIcon}
                        />
                        <Text style={styles.successMainTitle}>Payment Successful!</Text>
                        <Text style={styles.successSubtitle}>Thank you for your payment.</Text>
                        <View style={{ height: 18 }} />
                        <Text style={styles.successMessage}>Your transaction has been processed successfully.</Text>
                    </View>
                </View>
            </View>

            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Done',
                        onPress: onDone,
                        icon: 'checkmark',
                        variant: 'primary',
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    );
};

export default PaymentSuccessStep;
