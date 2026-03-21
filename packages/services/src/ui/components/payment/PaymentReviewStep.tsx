import type React from 'react';
import { useMemo } from 'react';
import { View, Text, Animated } from 'react-native';
import { GroupedSection } from '../index';
import GroupedPillButtons from '../internal/GroupedPillButtons';
import { createPaymentStyles } from './paymentStyles';
import { PAYMENT_METHODS, getCurrencySymbol } from './constants';
import type { CardDetails, PaymentColors, PaymentStepAnimations } from './types';
import { useI18n } from '../../hooks/useI18n';

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
    const { t } = useI18n();
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
                <Text style={styles.sectionTitle}>{t('payment.review.title')}</Text>

                <GroupedSection
                    items={[
                        {
                            id: 'secure-payment',
                            icon: 'shield-check',
                            iconColor: colors.success || '#4BB543',
                            title: t('payment.review.securePayment'),
                            subtitle: t('payment.review.securePaymentDesc'),
                        },
                        {
                            id: 'amount',
                            icon: 'cash',
                            iconColor: colors.primary,
                            title: t('payment.review.amount'),
                            subtitle: `${currencySymbol} ${amount}`,
                        },
                        {
                            id: 'payment-method',
                            icon: selectedMethod?.icon as any,
                            iconColor: colors.primary,
                            title: t('payment.review.paymentMethod'),
                            subtitle: selectedMethod ? t(`payment.methods.${selectedMethod.key}.label`) : undefined,
                        },
                        ...(paymentMethod === 'card' ? [{
                            id: 'card-details',
                            icon: 'card' as const,
                            iconColor: colors.primary,
                            title: t('payment.review.card'),
                            subtitle: cardDetails.number.replace(/.(?=.{4})/g, '*'),
                        }] : []),
                        ...(paymentMethod === 'oxy' ? [{
                            id: 'oxy-balance',
                            icon: 'wallet' as const,
                            iconColor: colors.primary,
                            title: t('payment.review.oxyPayAccount'),
                            subtitle: t('payment.details.balance', { balance: '⊜ 123.45' }),
                        }] : []),
                        ...(paymentMethod === 'faircoin' ? [{
                            id: 'faircoin-wallet',
                            icon: 'qr-code' as const,
                            iconColor: colors.primary,
                            title: t('payment.review.faircoinWallet'),
                            subtitle: t('payment.review.paidViaQR'),
                        }] : []),
                    ]}
                />
            </View>

            <GroupedPillButtons
                buttons={[
                    {
                        text: t('payment.actions.back'),
                        onPress: onBack,
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: isPaying ? t('payment.review.processing') : t('payment.review.payNow'),
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
