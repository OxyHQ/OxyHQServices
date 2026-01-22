import React, { useMemo } from 'react';
import { View, Text, Animated } from 'react-native';
import { GroupedSection } from '../index';
import GroupedPillButtons from '../internal/GroupedPillButtons';
import { FAIRWalletIcon } from '../icon';
import { createPaymentStyles } from './paymentStyles';
import type { PaymentMethod, PaymentColors, PaymentStepAnimations } from './types';

interface PaymentMethodStepProps {
    availablePaymentMethods: PaymentMethod[];
    selectedMethod: string;
    onSelectMethod: (method: string) => void;
    colors: PaymentColors;
    animations: PaymentStepAnimations;
    onBack: () => void;
    onNext: () => void;
}

const PaymentMethodStep: React.FC<PaymentMethodStepProps> = ({
    availablePaymentMethods,
    selectedMethod,
    onSelectMethod,
    colors,
    animations,
    onBack,
    onNext,
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
            accessibilityLabel="Choose payment method step"
        >
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Choose Payment Method</Text>

                <GroupedSection
                    items={availablePaymentMethods.map(method => ({
                        id: method.key,
                        icon: method.key === 'faircoin' ? undefined : method.icon,
                        iconColor: method.key === 'card' ? '#007AFF' :
                            method.key === 'oxy' ? '#32D74B' :
                                method.key === 'faircoin' ? '#9ffb50' : colors.primary,
                        title: method.label,
                        subtitle: method.description,
                        onPress: () => onSelectMethod(method.key),
                        selected: selectedMethod === method.key,
                        showChevron: false,
                        customIcon: method.key === 'faircoin' ? (
                            <FAIRWalletIcon size={20} />
                        ) : undefined,
                    }))}
                />
            </View>

            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Back',
                        onPress: onBack,
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: 'Continue',
                        onPress: onNext,
                        icon: 'arrow-forward',
                        variant: 'primary',
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    );
};

export default PaymentMethodStep;
