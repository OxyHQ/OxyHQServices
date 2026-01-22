import React, { useMemo } from 'react';
import { View, Text, Animated } from 'react-native';
import { GroupedSection } from '../index';
import GroupedPillButtons from '../internal/GroupedPillButtons';
import { createPaymentStyles } from './paymentStyles';
import { PAYMENT_METHODS, getCurrencySymbol } from './constants';
import type { CardDetails, PaymentColors, PaymentStepAnimations } from './types';

interface PaymentReviewStepProps {
    amount: string | number;
    currency: string;
    paymentMethod: string;
    cardDetails: CardDetails;
    colors: PaymentColors;
    animations: PaymentStepAnimations;
    isPaying: boolean;
    onBack: () => void;
    onPay: () => void;
}

const PaymentReviewStep: React.FC<PaymentReviewStepProps> = ({
    amount,
    currency,
    paymentMethod,
    cardDetails,
    colors,
    animations,
    isPaying,
    onBack,
    onPay,
}) => {
    const styles = useMemo(() => createPaymentStyles(colors), [colors]);
    const currencySymbol = getCurrencySymbol(currency);
    const { fadeAnim, slideAnim, scaleAnim } = animations;

    const selectedMethod = PAYMENT_METHODS.find(m => m.key === paymentMethod);

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
            accessibilityLabel="Review payment step"
        >
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Review Payment</Text>

                <GroupedSection
                    items={[
                        {
                            id: 'secure-payment',
                            icon: 'shield-check',
                            iconColor: colors.success || '#4BB543',
                            title: 'Secure payment',
                            subtitle: 'Your payment is protected by industry-standard encryption',
                        },
                        {
                            id: 'amount',
                            icon: 'cash',
                            iconColor: colors.primary,
                            title: 'Amount',
                            subtitle: `${currencySymbol} ${amount}`,
                        },
                        {
                            id: 'payment-method',
                            icon: selectedMethod?.icon as any,
                            iconColor: colors.primary,
                            title: 'Payment Method',
                            subtitle: selectedMethod?.label,
                        },
                        ...(paymentMethod === 'card' ? [{
                            id: 'card-details',
                            icon: 'card' as const,
                            iconColor: colors.primary,
                            title: 'Card',
                            subtitle: cardDetails.number.replace(/.(?=.{4})/g, '*'),
                        }] : []),
                        ...(paymentMethod === 'oxy' ? [{
                            id: 'oxy-balance',
                            icon: 'wallet' as const,
                            iconColor: colors.primary,
                            title: 'Oxy Pay Account',
                            subtitle: 'Balance: ⊜ 123.45',
                        }] : []),
                        ...(paymentMethod === 'faircoin' ? [{
                            id: 'faircoin-wallet',
                            icon: 'qr-code' as const,
                            iconColor: colors.primary,
                            title: 'FairCoin Wallet',
                            subtitle: 'Paid via QR',
                        }] : []),
                    ]}
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
                        text: isPaying ? 'Processing...' : 'Pay Now',
                        onPress: onPay,
                        icon: 'checkmark',
                        variant: 'primary',
                        loading: isPaying,
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    );
};

export default PaymentReviewStep;
