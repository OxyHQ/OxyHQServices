import React, { useMemo } from 'react';
import { View, Text, Animated, TouchableOpacity, Clipboard, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../internal/GroupedPillButtons';
import TextField from '../TextField';
import { FAIRWalletIcon } from '../icon';
import { createPaymentStyles } from './paymentStyles';
import { toast } from '../../../lib/sonner';
import type { CardDetails, PaymentColors, PaymentStepAnimations } from './types';

interface PaymentDetailsStepProps {
    paymentMethod: string;
    cardDetails: CardDetails;
    onCardDetailsChange: (details: CardDetails) => void;
    colors: PaymentColors;
    animations: PaymentStepAnimations;
    faircoinAddress: string;
    isMobile: boolean;
    qrSize: number;
    onBack: () => void;
    onNext: () => void;
    QRCodeComponent?: React.ComponentType<{ value?: string; size?: number }>;
}

const PaymentDetailsStep: React.FC<PaymentDetailsStepProps> = ({
    paymentMethod,
    cardDetails,
    onCardDetailsChange,
    colors,
    animations,
    faircoinAddress,
    isMobile,
    qrSize,
    onBack,
    onNext,
    QRCodeComponent,
}) => {
    const styles = useMemo(() => createPaymentStyles(colors), [colors]);
    const { fadeAnim, slideAnim, scaleAnim } = animations;

    const handleCopyAddress = () => {
        Clipboard.setString(faircoinAddress);
        toast('Address copied to clipboard!');
    };

    const handleOpenFairWallet = () => {
        const url = `fairwallet://pay?address=${faircoinAddress}`;
        Linking.openURL(url);
    };

    const isCardValid = cardDetails.number && cardDetails.expiry && cardDetails.cvv;

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
            accessibilityLabel="Enter payment details step"
        >
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                    {paymentMethod === 'card' ? 'Card Details' :
                        paymentMethod === 'oxy' ? 'Oxy Pay' :
                            paymentMethod === 'faircoin' ? 'FairCoin Payment' : 'Payment Details'}
                </Text>

                {paymentMethod === 'card' && (
                    <View style={styles.cardPaymentCard}>
                        <View style={styles.cardPaymentContent}>
                            <Ionicons name="card-outline" size={64} color={colors.primary} style={styles.cardPaymentIcon} />
                            <Text style={styles.cardPaymentMainTitle}>Credit Card</Text>
                            <Text style={styles.cardPaymentSubtitle}>Enter your card details securely</Text>

                            <View style={styles.cardPaymentFields}>
                                <View style={styles.cardRowInfo}>
                                    <Ionicons name="card-outline" size={24} color={colors.primary} style={styles.cardRowIcon} />
                                    <Text style={styles.cardRowText}>We accept Visa, Mastercard, and more</Text>
                                </View>
                                <TextField
                                    value={cardDetails.number}
                                    onChangeText={text => {
                                        const formatted = text.replace(/\s/g, '').replace(/(\d{4})/g, '$1 ').trim();
                                        onCardDetailsChange({ ...cardDetails, number: formatted });
                                    }}
                                    placeholder="1234 5678 9012 3456"
                                    keyboardType="numeric"
                                    maxLength={19}
                                    style={styles.cardFieldContainer}
                                    left={<Ionicons name="card-outline" size={18} color={colors.primary} />}
                                    accessibilityLabel="Card number"
                                    accessibilityHint="Enter your 16-digit card number"
                                />
                                <View style={styles.cardFieldRow}>
                                    <TextField
                                        value={cardDetails.expiry}
                                        onChangeText={text => {
                                            const formatted = text.replace(/\D/g, '').replace(/(\d{2})(\d)/, '$1/$2');
                                            onCardDetailsChange({ ...cardDetails, expiry: formatted });
                                        }}
                                        placeholder="MM/YY"
                                        maxLength={5}
                                        style={styles.cardFieldHalfLeft}
                                        left={<Ionicons name="calendar-outline" size={16} color={colors.primary} />}
                                        accessibilityLabel="Expiry date"
                                        accessibilityHint="Enter expiry date in MM/YY format"
                                    />
                                    <TextField
                                        value={cardDetails.cvv}
                                        onChangeText={text => {
                                            const formatted = text.replace(/\D/g, '');
                                            onCardDetailsChange({ ...cardDetails, cvv: formatted });
                                        }}
                                        placeholder="123"
                                        keyboardType="numeric"
                                        maxLength={4}
                                        style={styles.cardFieldHalfRight}
                                        left={<Ionicons name="lock-closed-outline" size={16} color={colors.primary} />}
                                        accessibilityLabel="CVV"
                                        accessibilityHint="Enter 3 or 4 digit security code"
                                    />
                                </View>
                            </View>

                            <View style={{ height: 18 }} />
                            <Text style={styles.cardPaymentWaiting}>Ready to process payment...</Text>
                        </View>
                    </View>
                )}

                {paymentMethod === 'oxy' && (
                    <View style={styles.oxyPayCard}>
                        <View style={styles.oxyPayContent}>
                            <Ionicons name="wallet-outline" size={64} color={colors.primary} style={styles.oxyPayIcon} />
                            <Text style={styles.oxyPayMainTitle}>Oxy Pay</Text>
                            <Text style={styles.oxyPaySubtitle}>Pay with your in-app wallet</Text>
                            <View style={styles.oxyPayBalanceBox}>
                                <Text style={styles.oxyPayBalanceText}>Balance: ⊜ 123.45</Text>
                            </View>
                            <View style={{ height: 18 }} />
                            <Text style={styles.oxyPayWaiting}>Ready to process payment...</Text>
                        </View>
                    </View>
                )}

                {paymentMethod === 'faircoin' && (
                    <View style={styles.faircoinCard}>
                        <View style={styles.faircoinContent}>
                            <FAIRWalletIcon size={64} style={styles.faircoinIcon} />
                            <Text style={styles.faircoinMainTitle}>FAIRWallet</Text>
                            <Text style={styles.faircoinSubtitle}>Pay with FairCoin</Text>
                            {!isMobile && QRCodeComponent ? (
                                <>
                                    <Text style={styles.faircoinScanText}>Scan to Pay</Text>
                                    <View style={styles.faircoinQRCard}>
                                        <QRCodeComponent value={faircoinAddress} size={qrSize - 32} />
                                        <View style={styles.faircoinQRBadge}>
                                            <FAIRWalletIcon size={28} />
                                        </View>
                                    </View>
                                </>
                            ) : (
                                <>
                                    <Text style={styles.faircoinTitle}>Use the options below to pay with FAIRWallet</Text>
                                    <Text style={styles.faircoinAddress}>{faircoinAddress}</Text>
                                    <TouchableOpacity
                                        style={[styles.faircoinButton, { backgroundColor: '#9ffb50', borderRadius: 18, marginTop: 12, width: '90%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]}
                                        onPress={handleOpenFairWallet}
                                        accessibilityRole="button"
                                        accessibilityLabel="Open in FAIRWallet"
                                    >
                                        <FAIRWalletIcon size={20} style={{ marginRight: 8 }} />
                                        <Text style={[styles.faircoinButtonText, { color: '#1b1f0a', fontWeight: 'bold', fontSize: 16 }]}>Open in FAIRWallet</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.faircoinButton, { backgroundColor: '#9ffb50', borderRadius: 18, marginTop: 10, width: '90%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]}
                                        onPress={handleCopyAddress}
                                        accessibilityRole="button"
                                        accessibilityLabel="Copy FairCoin address"
                                    >
                                        <FAIRWalletIcon size={20} style={{ marginRight: 8 }} />
                                        <Text style={[styles.faircoinButtonText, { color: '#1b1f0a', fontWeight: 'bold', fontSize: 16 }]}>Copy Address</Text>
                                    </TouchableOpacity>
                                </>
                            )}
                            <View style={{ height: 18 }} />
                            <Text style={styles.faircoinWaiting}>Waiting for payment...</Text>
                        </View>
                    </View>
                )}
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
                        disabled: paymentMethod === 'card' && !isCardValid,
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    );
};

export default PaymentDetailsStep;
