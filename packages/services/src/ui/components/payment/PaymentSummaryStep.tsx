import React, { useMemo } from 'react';
import { View, Text, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GroupedSection } from '../index';
import GroupedPillButtons from '../internal/GroupedPillButtons';
import { createPaymentStyles } from './paymentStyles';
import { getCurrencySymbol, CURRENCY_SYMBOLS } from './constants';
import type { PaymentItem, PaymentColors, PaymentStepAnimations } from './types';

interface PaymentSummaryStepProps {
    paymentItems: PaymentItem[];
    amount: string | number;
    currency: string;
    description?: string;
    colors: PaymentColors;
    animations: PaymentStepAnimations;
    onClose: () => void;
    onNext: () => void;
}

const getItemTypeIcon = (type: string): string => {
    switch (type) {
        case 'product': return 'cart-outline';
        case 'subscription': return 'repeat-outline';
        case 'service': return 'construct-outline';
        case 'fee': return 'cash-outline';
        default: return 'pricetag-outline';
    }
};

const PaymentSummaryStep: React.FC<PaymentSummaryStepProps> = ({
    paymentItems,
    amount,
    currency,
    description,
    colors,
    animations,
    onClose,
    onNext,
}) => {
    const styles = useMemo(() => createPaymentStyles(colors), [colors]);
    const currencySymbol = getCurrencySymbol(currency);
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
            accessibilityLabel="Payment summary step"
        >
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Payment Summary</Text>

                <View style={styles.summaryCard}>
                    <View style={styles.summaryCardContent}>
                        <Ionicons
                            name="receipt-outline"
                            size={64}
                            color={colors.primary}
                            style={styles.summaryCardIcon}
                        />
                        <Text style={styles.summaryCardMainTitle}>
                            {paymentItems.length > 0 ? 'Order Summary' : 'Payment'}
                        </Text>
                        <Text style={styles.summaryCardSubtitle}>
                            {paymentItems.length > 0 ? 'Review your payment details' : 'Complete your payment'}
                        </Text>

                        {paymentItems.length > 0 ? (
                            <>
                                <View style={styles.summaryCardItems}>
                                    <GroupedSection
                                        items={paymentItems.map((item, idx) => ({
                                            id: `item-${idx}`,
                                            icon: getItemTypeIcon(item.type) as any,
                                            iconColor: colors.primary,
                                            title: `${item.type === 'product' && item.quantity ? `${item.quantity} × ` : ''}${item.name}${item.type === 'subscription' && item.period ? ` (${item.period})` : ''}`,
                                            subtitle: item.description || `${item.currency ? (CURRENCY_SYMBOLS[item.currency.toUpperCase()] || item.currency) : currencySymbol} ${item.price * (item.quantity ?? 1)}`,
                                            customContent: (
                                                <Text style={styles.summaryItemPrice}>
                                                    {item.currency ? (CURRENCY_SYMBOLS[item.currency.toUpperCase()] || item.currency) : currencySymbol} {item.price * (item.quantity ?? 1)}
                                                </Text>
                                            ),
                                        }))}
                                    />
                                </View>

                                <View style={styles.summaryCardDivider} />

                                <View style={styles.summaryCardTotalSection}>
                                    <View style={styles.summaryCardTotalRow}>
                                        <Text style={styles.summaryCardTotalLabel}>Subtotal</Text>
                                        <Text style={styles.summaryCardTotalValue}>{currencySymbol} {amount}</Text>
                                    </View>
                                    <View style={styles.summaryCardTotalRow}>
                                        <Text style={styles.summaryCardTotalLabel}>Tax</Text>
                                        <Text style={styles.summaryCardTotalValue}>{currencySymbol} 0.00</Text>
                                    </View>
                                    <View style={styles.summaryCardTotalRow}>
                                        <Text style={styles.summaryCardTotalLabel}>Total</Text>
                                        <Text style={styles.summaryCardTotalValue}>{currencySymbol} {amount}</Text>
                                    </View>
                                </View>
                            </>
                        ) : (
                            <>
                                <View style={styles.summaryCardAmount}>
                                    <Text style={styles.summaryCardAmountLabel}>Amount to Pay</Text>
                                    <Text style={styles.summaryCardAmountValue}>{currencySymbol} {amount}</Text>
                                    {description && (
                                        <Text style={styles.summaryCardAmountDescription}>{description}</Text>
                                    )}
                                </View>

                                <View style={styles.summaryCardDivider} />

                                <View style={styles.summaryCardTotalSection}>
                                    <View style={styles.summaryCardTotalRow}>
                                        <Text style={styles.summaryCardTotalLabel}>Total</Text>
                                        <Text style={styles.summaryCardTotalValue}>{currencySymbol} {amount}</Text>
                                    </View>
                                </View>
                            </>
                        )}
                    </View>
                </View>
            </View>

            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Close',
                        onPress: onClose,
                        icon: 'close',
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

export default PaymentSummaryStep;
