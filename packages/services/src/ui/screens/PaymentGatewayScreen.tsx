import type React from 'react';
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Platform,
    KeyboardAvoidingView,
    ScrollView,
    Animated,
    StatusBar,
    ScrollView as RNScrollView,
    Dimensions,
    Linking,
    Clipboard,
    useWindowDimensions,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { fontFamilies, useThemeColors, createCommonStyles } from '../styles';
import { normalizeTheme } from '../utils/themeUtils';
import OxyLogo from '../components/OxyLogo';
import GroupedPillButtons from '../components/internal/GroupedPillButtons';
import TextField from '../components/TextField';
import { Ionicons } from '@expo/vector-icons';
import { FAIRWalletIcon } from '../components/icon';
import { toast } from 'sonner';
import QRCode from 'react-native-qrcode-svg';

import { GroupedSection } from '../components';
import { useThemeStyles } from '../hooks/useThemeStyles';

// Restrict payment methods to Card, Oxy Pay, and FairCoin (QR)
const PAYMENT_METHODS = [
    { key: 'card', label: 'Credit/Debit Card', icon: 'card-outline', description: 'Pay securely with your credit or debit card.' },
    { key: 'oxy', label: 'Oxy Pay', icon: 'wallet-outline', description: 'Use your Oxy Pay in-app balance.' },
    { key: 'faircoin', label: 'FAIRWallet', icon: 'qr-code-outline', description: 'Pay with FairCoin by scanning a QR code.' },
];



// Add PaymentItem type
export type PaymentItem = {
    type: 'product' | 'subscription' | 'service' | 'fee' | string;
    name: string;
    description?: string;
    quantity?: number; // for products
    period?: string;   // for subscriptions, e.g. 'Monthly'
    price: number;
    currency?: string; // fallback to main currency if not set
};

// Extend props to accept onPaymentResult, amount, and currency
export interface PaymentGatewayResult {
    success: boolean;
    details?: Record<string, string | number | boolean | null>;
    error?: string;
}

interface PaymentGatewayScreenProps extends BaseScreenProps {
    onPaymentResult?: (result: PaymentGatewayResult) => void;
    amount: string | number;
    currency?: string; // e.g. 'FAIR', 'INR', 'USD', 'EUR', 'GBP', etc.
    onClose?: () => void;
    paymentItems?: PaymentItem[]; // NEW: generic items
    description?: string; // NEW: fallback if no items
}

// Currency symbol map
const CURRENCY_SYMBOLS: Record<string, string> = {
    FAIR: '⊜',
    INR: '₹',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CNY: '¥',
    AUD: 'A$',
    CAD: 'C$',
    // Add more as needed
};

const CURRENCY_NAMES: Record<string, string> = {
    FAIR: 'FairCoin',
    INR: 'Indian Rupee',
    USD: 'US Dollar',
    EUR: 'Euro',
    GBP: 'British Pound',
    JPY: 'Japanese Yen',
    CNY: 'Chinese Yuan',
    AUD: 'Australian Dollar',
    CAD: 'Canadian Dollar',
    // Add more as needed
};

// Helper: icon for item type (Ionicons only)
const getItemTypeIcon = (type: string, color: string) => {
    switch (type) {
        case 'product':
            return <Ionicons name="cart-outline" size={22} color={color} style={{ marginRight: 8 }} />;
        case 'subscription':
            return <Ionicons name="repeat-outline" size={22} color={color} style={{ marginRight: 8 }} />;
        case 'service':
            return <Ionicons name="construct-outline" size={22} color={color} style={{ marginRight: 8 }} />;
        case 'fee':
            return <Ionicons name="cash-outline" size={22} color={color} style={{ marginRight: 8 }} />;
        default:
            return <Ionicons name="pricetag-outline" size={22} color={color} style={{ marginRight: 8 }} />;
    }
};


// Helper to get unique item types (move to top-level, before component)
const getUniqueItemTypes = (items: PaymentItem[]) => {
    const types = items.map(item => item.type);
    return Array.from(new Set(types));
};

const PaymentGatewayScreen: React.FC<PaymentGatewayScreenProps> = (props) => {
    const {
        navigate,
        goBack,
        theme,
        onPaymentResult,
        amount,
        currency = 'FAIR',
        onClose,
        paymentItems = [], // NEW
        description = '', // NEW
    } = props;

    // DEV ENFORCEMENT: Only allow one type of payment item
    if (process.env.NODE_ENV !== 'production' && paymentItems.length > 0) {
        const uniqueTypes = getUniqueItemTypes(paymentItems);
        if (uniqueTypes.length > 1) {
            throw new Error(
                `PaymentGatewayScreen: paymentItems contains mixed types (${uniqueTypes.join(', ')}). Only one type is allowed per payment.`
            );
        }
    }

    // Step states
    const [currentStep, setCurrentStep] = useState(0);
    const [paymentMethod, setPaymentMethod] = useState('card');
    const [cardDetails, setCardDetails] = useState({ number: '', expiry: '', cvv: '' });
    const [upiId, setUpiId] = useState('');
    const [isPaying, setIsPaying] = useState(false);
    const [success, setSuccess] = useState(false);



    // Animations
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const progressAnim = useRef(new Animated.Value(0.2)).current;

    const normalizedTheme = normalizeTheme(theme);
    const colors = useThemeColors(normalizedTheme);
    const commonStyles = createCommonStyles(normalizedTheme);
    const styles = useMemo(() => createStyles(colors, normalizedTheme), [colors, normalizedTheme]);

    // Get symbol and name for currency
    const currencySymbol = CURRENCY_SYMBOLS[currency.toUpperCase()] || currency;
    const currencyName = CURRENCY_NAMES[currency.toUpperCase()] || currency;

    // Calculate total from items if provided, else use amount
    const computedTotal = useMemo(() => {
        if (paymentItems && paymentItems.length > 0) {
            return paymentItems.reduce((sum, item) => {
                const qty = item.quantity ?? 1;
                return sum + (item.price * qty);
            }, 0);
        }
        return Number(amount) || 0;
    }, [paymentItems, amount]);

    // Determine if the payment is for a recurring item (subscription)
    const isRecurring = paymentItems.length > 0 && paymentItems[0].type === 'subscription';

    // Filter payment methods: remove 'faircoin' if recurring
    const availablePaymentMethods = useMemo(() => {
        if (isRecurring) {
            return PAYMENT_METHODS.filter(m => m.key !== 'faircoin');
        }
        return PAYMENT_METHODS;
    }, [isRecurring]);

    // Add after useState declarations
    // Remove itemTypeError state, useEffect, and user-facing error in renderSummaryStep

    // Helper to get unique item types
    // Remove itemTypeError state, useEffect, and user-facing error in renderSummaryStep

    // Validate item types on paymentItems change
    // Remove itemTypeError state, useEffect, and user-facing error in renderSummaryStep

    // Animation transitions
    const animateTransition = useCallback((nextStep: number) => {
        Animated.timing(scaleAnim, {
            toValue: 0.95,
            duration: 150,
            useNativeDriver: Platform.OS !== 'web',
        }).start();
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: Platform.OS !== 'web',
        }).start(() => {
            setCurrentStep(nextStep);
            slideAnim.setValue(-50);
            scaleAnim.setValue(0.95);
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: Platform.OS !== 'web',
                }),
                Animated.spring(slideAnim, {
                    toValue: 0,
                    tension: 80,
                    friction: 8,
                    useNativeDriver: Platform.OS !== 'web',
                }),
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    tension: 80,
                    friction: 8,
                    useNativeDriver: Platform.OS !== 'web',
                })
            ]).start();
        });
    }, []);

    const nextStep = useCallback(() => {
        if (currentStep < 4) {
            Animated.timing(progressAnim, {
                toValue: (currentStep + 2) / 5,
                duration: 300,
                useNativeDriver: false,
            }).start();
            animateTransition(currentStep + 1);
        }
    }, [currentStep, progressAnim, animateTransition]);

    const prevStep = useCallback(() => {
        if (currentStep > 0) {
            Animated.timing(progressAnim, {
                toValue: (currentStep) / 5,
                duration: 300,
                useNativeDriver: false,
            }).start();
            animateTransition(currentStep - 1);
        }
    }, [currentStep, progressAnim, animateTransition]);

    // Dummy pay handler
    const handlePay = useCallback(() => {
        setIsPaying(true);
        setTimeout(() => {
            setIsPaying(false);
            setSuccess(true);
            nextStep();
        }, 1500);
    }, [nextStep]);

    // Success handler for Done button
    const handleDone = useCallback(() => {
        if (onPaymentResult) {
            onPaymentResult({ success: true });
        }
        navigate?.('AccountOverview');
    }, [onPaymentResult, navigate]);

    // Handle close/cancel: return failure result if payment is not completed
    const handleClose = useCallback(() => {
        if (onPaymentResult) {
            onPaymentResult({ success: false, error: 'cancelled' });
        }
        if (onClose) {
            onClose();
        } else if (goBack) {
            goBack();
        }
    }, [onPaymentResult, onClose, goBack]);

    // Optionally, intercept goBack/onClose if user tries to close the screen
    // (You may want to use useEffect to listen for unmount or navigation away)

    // If amount is missing or invalid, show error
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        return (
            <View style={styles.errorContainer}>
                <Text style={styles.errorText}>Invalid or missing payment amount.</Text>
                <GroupedPillButtons
                    buttons={[
                        {
                            text: 'Close',
                            onPress: handleClose,
                            icon: 'close',
                            variant: 'primary',
                        },
                    ]}
                    colors={useThemeColors(normalizedTheme)}
                />
            </View>
        );
    }

    // Example FairCoin address (replace with real one)
    const faircoinAddress = 'f1abc1234FAIRCOINADDRESS';
    const { width: windowWidth } = useWindowDimensions();
    const isMobile = windowWidth < 600;
    const qrSize = !isMobile
        ? Math.min(windowWidth * 0.3, 220)
        : Math.min(windowWidth * 0.8, 300);

    const handleCopyAddress = () => {
        Clipboard.setString(faircoinAddress);
        toast('Address copied to clipboard!');
    };
    const handleOpenFairWallet = () => {
        const url = `fairwallet://pay?address=${faircoinAddress}`;
        Linking.openURL(url);
    };



    // Helper for dynamic styles
    const getStepIndicatorStyle = (active: boolean) => [
        styles.stepIndicator,
        active ? styles.stepIndicatorActive : styles.stepIndicatorInactive,
    ];

    const getPaymentMethodButtonStyle = (active: boolean) => [
        styles.paymentMethodButton,
        active ? styles.paymentMethodButtonActive : styles.paymentMethodButtonInactive,
    ];

    const getPaymentMethodIconColor = (active: boolean) => (
        active ? colors.primary : colors.text
    );

    // Step indicator
    const renderStepIndicator = () => {
        const totalSteps = 5;
        const activeStep = currentStep + 1;
        return (
            <View style={styles.stepIndicatorContainer}>
                {Array.from({ length: totalSteps }).map((_, idx) => (
                    <View
                        key={idx}
                        style={getStepIndicatorStyle(activeStep === idx + 1)}
                    />
                ))}
            </View>
        );
    };

    // PaymentGatewayHeader component
    const stepTitles = [
        'Complete Your Payment',
        'Select Payment Method',
        'Enter Payment Details',
        'Review & Pay',
        'Success',
    ];






    // Step 1: Summary step (new first step, no header/dots here)
    const renderSummaryStep = () => (
        <Animated.View style={[styles.stepContainer, {
            opacity: fadeAnim,
            transform: [
                { translateY: slideAnim },
                { scale: scaleAnim },
            ]
        }]}
        >
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Payment Summary</Text>

                <View style={styles.summaryCard}>
                    <View style={styles.summaryCardContent}>
                        <Ionicons name="receipt-outline" size={64} color={colors.primary} style={styles.summaryCardIcon} />
                        <Text style={styles.summaryCardMainTitle}>
                            {paymentItems && paymentItems.length > 0 ? 'Order Summary' : 'Payment'}
                        </Text>
                        <Text style={styles.summaryCardSubtitle}>
                            {paymentItems && paymentItems.length > 0 ? 'Review your payment details' : 'Complete your payment'}
                        </Text>

                        {paymentItems && paymentItems.length > 0 ? (
                            <>
                                <View style={styles.summaryCardItems}>
                                    <GroupedSection
                                        items={paymentItems.map((item, idx) => ({
                                            id: `item-${idx}`,
                                            icon: getItemTypeIcon(item.type, colors.primary).props.name,
                                            iconColor: colors.primary,
                                            title: `${item.type === 'product' && item.quantity ? `${item.quantity} × ` : ''}${item.name}${item.type === 'subscription' && item.period ? ` (${item.period})` : ''}`,
                                            subtitle: item.description || `${(item.currency ? (CURRENCY_SYMBOLS[item.currency.toUpperCase()] || item.currency) : currencySymbol)} ${item.price * (item.quantity ?? 1)}`,
                                            customContent: (
                                                <Text style={styles.summaryItemPrice}>
                                                    {(item.currency ? (CURRENCY_SYMBOLS[item.currency.toUpperCase()] || item.currency) : currencySymbol)} {item.price * (item.quantity ?? 1)}
                                                </Text>
                                            ),
                                        }))}

                                    />
                                </View>

                                <View style={styles.summaryCardDivider} />

                                <View style={styles.summaryCardTotalSection}>
                                    <View style={styles.summaryCardTotalRow}>
                                        <Text style={styles.summaryCardTotalLabel}>Subtotal</Text>
                                        <Text style={styles.summaryCardTotalValue}>{(currencySymbol)} {amount}</Text>
                                    </View>
                                    <View style={styles.summaryCardTotalRow}>
                                        <Text style={styles.summaryCardTotalLabel}>Tax</Text>
                                        <Text style={styles.summaryCardTotalValue}>{(currencySymbol)} 0.00</Text>
                                    </View>
                                    <View style={styles.summaryCardTotalRow}>
                                        <Text style={styles.summaryCardTotalLabel}>Total</Text>
                                        <Text style={styles.summaryCardTotalValue}>{(currencySymbol)} {amount}</Text>
                                    </View>
                                </View>
                            </>
                        ) : (
                            <>
                                <View style={styles.summaryCardAmount}>
                                    <Text style={styles.summaryCardAmountLabel}>Amount to Pay</Text>
                                    <Text style={styles.summaryCardAmountValue}>{(currencySymbol)} {amount}</Text>
                                    {description && (
                                        <Text style={styles.summaryCardAmountDescription}>{description}</Text>
                                    )}
                                </View>

                                <View style={styles.summaryCardDivider} />

                                <View style={styles.summaryCardTotalSection}>
                                    <View style={styles.summaryCardTotalRow}>
                                        <Text style={styles.summaryCardTotalLabel}>Total</Text>
                                        <Text style={styles.summaryCardTotalValue}>{(currencySymbol)} {amount}</Text>
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
                        onPress: handleClose,
                        icon: 'close',
                        variant: 'transparent',
                    },
                    {
                        text: 'Continue',
                        onPress: nextStep,
                        icon: 'arrow-forward',
                        variant: 'primary',
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    );

    // Step 2: Choose Payment Method (now the second step, no header/dots here)
    const renderMethodStep = () => (
        <Animated.View style={[styles.stepContainer, {
            opacity: fadeAnim,
            transform: [
                { translateY: slideAnim },
                { scale: scaleAnim },
            ]
        }]}
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
                        onPress: () => setPaymentMethod(method.key),
                        selected: paymentMethod === method.key,
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
                        onPress: prevStep,
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: 'Continue',
                        onPress: nextStep,
                        icon: 'arrow-forward',
                        variant: 'primary',
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    );

    // Step 2: Enter Payment Details
    const renderDetailsStep = () => (
        <Animated.View style={[styles.stepContainer, {
            opacity: fadeAnim,
            transform: [
                { translateY: slideAnim },
                { scale: scaleAnim },
            ]
        }]}
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
                                        // Format card number with spaces
                                        const formatted = text.replace(/\s/g, '').replace(/(\d{4})/g, '$1 ').trim();
                                        setCardDetails({ ...cardDetails, number: formatted });
                                    }}
                                    placeholder="1234 5678 9012 3456"
                                    keyboardType="numeric"
                                    maxLength={19}
                                    style={styles.cardFieldContainer}
                                    leading={<Ionicons name="card-outline" size={18} color={colors.primary} />}
                                />
                                <View style={styles.cardFieldRow}>
                                    <TextField
                                        value={cardDetails.expiry}
                                        onChangeText={text => {
                                            // Format expiry date
                                            const formatted = text.replace(/\D/g, '').replace(/(\d{2})(\d)/, '$1/$2');
                                            setCardDetails({ ...cardDetails, expiry: formatted });
                                        }}
                                        placeholder="MM/YY"
                                        maxLength={5}
                                        style={styles.cardFieldHalfLeft}
                                        leading={<Ionicons name="calendar-outline" size={16} color={colors.primary} />}
                                    />
                                    <TextField
                                        value={cardDetails.cvv}
                                        onChangeText={text => {
                                            // Only allow numbers
                                            const formatted = text.replace(/\D/g, '');
                                            setCardDetails({ ...cardDetails, cvv: formatted });
                                        }}
                                        placeholder="123"
                                        keyboardType="numeric"
                                        maxLength={4}
                                        style={styles.cardFieldHalfRight}
                                        leading={<Ionicons name="lock-closed-outline" size={16} color={colors.primary} />}
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
                            {!isMobile ? (
                                <>
                                    <Text style={styles.faircoinScanText}>Scan to Pay</Text>
                                    <View style={styles.faircoinQRCard}>
                                        <QRCode value={faircoinAddress} size={qrSize - 32} />
                                        <View style={styles.faircoinQRBadge}>
                                            <FAIRWalletIcon size={28} />
                                        </View>
                                    </View>
                                </>
                            ) : (
                                <>
                                    <Text style={styles.faircoinTitle}>Use the options below to pay with FAIRWallet</Text>
                                    <Text style={styles.faircoinAddress}>{faircoinAddress}</Text>
                                    <TouchableOpacity style={[styles.faircoinButton, { backgroundColor: '#9ffb50', borderRadius: 18, marginTop: 12, width: '90%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]} onPress={handleOpenFairWallet}>
                                        <FAIRWalletIcon size={20} style={{ marginRight: 8 }} />
                                        <Text style={[styles.faircoinButtonText, { color: '#1b1f0a', fontWeight: 'bold', fontSize: 16 }]}>Open in FAIRWallet</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={[styles.faircoinButton, { backgroundColor: '#9ffb50', borderRadius: 18, marginTop: 10, width: '90%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]} onPress={handleCopyAddress}>
                                        <FAIRWalletIcon size={20} style={{ marginRight: 8 }} />
                                        <Text style={[styles.faircoinButtonText, { color: '#1b1f0a', fontWeight: 'bold', fontSize: 16 }]}>Copy Address</Text>
                                    </TouchableOpacity>
                                </>
                            )}
                            <View style={{ height: 18 }} />
                            <Text style={styles.faircoinWaiting}>Waiting for payment...</Text>
                            {/* TODO: Integrate QR code generator for FAIRWallet payments */}
                            <Text style={styles.faircoinPlaceholder}>(This is a placeholder. Integrate with a QR code generator for production.)</Text>
                        </View>
                    </View>
                )}
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
                        text: 'Continue',
                        onPress: nextStep,
                        icon: 'arrow-forward',
                        variant: 'primary',
                        disabled:
                            (paymentMethod === 'card' && (!cardDetails.number || !cardDetails.expiry || !cardDetails.cvv)),
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    );

    // Step 4: Review & Pay
    const renderReviewStep = () => (
        <Animated.View style={[styles.stepContainer, {
            opacity: fadeAnim,
            transform: [
                { translateY: slideAnim },
                { scale: scaleAnim },
            ]
        }]}
        >
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Review Payment</Text>

                <GroupedSection
                    items={[
                        {
                            id: 'secure-payment',
                            icon: 'shield-checkmark',
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
                            icon: PAYMENT_METHODS.find(m => m.key === paymentMethod)?.icon as any,
                            iconColor: colors.primary,
                            title: 'Payment Method',
                            subtitle: PAYMENT_METHODS.find(m => m.key === paymentMethod)?.label,
                        },
                        ...(paymentMethod === 'card' ? [{
                            id: 'card-details',
                            icon: 'card',
                            iconColor: colors.primary,
                            title: 'Card',
                            subtitle: cardDetails.number.replace(/.(?=.{4})/g, '*'),
                        }] : []),
                        ...(paymentMethod === 'oxy' ? [{
                            id: 'oxy-balance',
                            icon: 'wallet',
                            iconColor: colors.primary,
                            title: 'Oxy Pay Account',
                            subtitle: 'Balance: ⊜ 123.45',
                        }] : []),
                        ...(paymentMethod === 'faircoin' ? [{
                            id: 'faircoin-wallet',
                            icon: 'qr-code',
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
                        onPress: prevStep,
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: isPaying ? 'Processing...' : 'Pay Now',
                        onPress: handlePay,
                        icon: 'checkmark',
                        variant: 'primary',
                        loading: isPaying,
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    );

    // Step 5: Success
    const renderSuccessStep = () => (
        <Animated.View style={[styles.stepContainer, {
            opacity: fadeAnim,
            transform: [
                { translateY: slideAnim },
                { scale: scaleAnim },
            ]
        }]}
        >
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Payment Complete</Text>

                <View style={styles.successCard}>
                    <View style={styles.successContent}>
                        <Ionicons name="checkmark-circle" size={64} color={colors.success || '#4BB543'} style={styles.successIcon} />
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
                        onPress: handleDone,
                        icon: 'checkmark',
                        variant: 'primary',
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    );



    const renderCurrentStep = () => {
        switch (currentStep) {
            case 0: return renderSummaryStep();
            case 1: return renderMethodStep();
            case 2: return renderDetailsStep();
            case 3: return renderReviewStep();
            case 4: return renderSuccessStep();
            default: return renderSummaryStep();
        }
    };

    // Use centralized theme styles hook for consistency
    // primaryColor from hook (#007AFF) is already correct for this screen
    const themeStyles = useThemeStyles(normalizedTheme);

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            {/* Content */}
            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {renderCurrentStep()}
            </ScrollView>
        </View>
    );
};

const createStyles = (colors: any, theme: string) => StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        padding: 16,
    },
    stepContainer: {
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        width: '100%',
    },
    section: {
        marginBottom: 24,
        width: '100%',
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        marginBottom: 12,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    stepIndicatorContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginVertical: 16,
    },
    stepIndicator: {
        height: 10,
        borderRadius: 5,
        marginHorizontal: 4,
    },
    stepIndicatorActive: {
        width: 28,
        backgroundColor: colors.primary,
    },
    stepIndicatorInactive: {
        width: 10,
        backgroundColor: colors.border,
    },
    logo: {
        width: 40,
        height: 20,
        alignSelf: 'center',
        resizeMode: 'contain',
    },
    headerTitle: {
        fontFamily: fontFamilies.phuduBold,
        fontSize: 22,
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        color: colors.text,
        letterSpacing: -0.5,
    },

    paymentMethodButton: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        width: '90%',
        alignSelf: 'center',
        borderWidth: 1,
    },
    paymentMethodButtonActive: {
        backgroundColor: colors.primary + '22',
        borderColor: colors.primary,
        borderWidth: 2,
    },
    paymentMethodButtonInactive: {
        backgroundColor: 'transparent',
        borderColor: colors.border,
        borderWidth: 1,
    },
    paymentMethodLabel: {
        fontFamily: fontFamilies.phudu,
        fontSize: 18,
        color: colors.text,
        fontWeight: '600',
    },
    paymentMethodDescription: {
        fontFamily: fontFamilies.phudu,
        fontSize: 15,
        color: colors.secondaryText,
        marginTop: 8,
        minHeight: 36,
        textAlign: 'center',
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    errorText: {
        fontSize: 18,
        color: 'red',
        marginBottom: 24,
    },
    methodListContainer: {
        width: '100%',
        alignItems: 'center',
    },
    methodIcon: {
        marginRight: 12,
    },
    methodCheckIcon: {
        marginLeft: 'auto',
    },
    cardRowInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    cardRowIcon: {
        marginRight: 8,
    },
    cardRowText: {
        fontSize: 15,
        color: colors.secondaryText,
    },
    cardFieldContainer: {
        marginBottom: 16,
    },
    cardFieldRow: {
        flexDirection: 'row',
        gap: 12,
    },
    cardFieldHalfLeft: {
        flex: 1,
        marginRight: 6,
    },
    cardFieldHalfRight: {
        flex: 1,
        marginLeft: 6,
    },
    oxyPayContainer: {
        alignItems: 'center',
    },
    oxyPayIcon: {
        marginBottom: 8,
    },
    oxyPayTitle: {
        fontSize: 16,
        marginBottom: 8,
        color: colors.text,
        fontWeight: '600',
        textAlign: 'center',
    },
    oxyPaySubtitle: {
        fontSize: 14,
        color: colors.secondaryText,
        marginBottom: 8,
        textAlign: 'center',
    },
    oxyPayBalanceBox: {
        backgroundColor: colors.primary + '22',
        borderRadius: 12,
        padding: 8,
        marginTop: 8,
    },
    oxyPayBalanceText: {
        color: colors.primary,
        fontWeight: '600',
    },
    oxyPayCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 24,
        marginBottom: 24,
        alignItems: 'center',
        width: '100%',
    },
    oxyPayContent: {
        alignItems: 'center',
        width: '100%',
    },
    oxyPayMainTitle: {
        fontFamily: fontFamilies.phuduBold,
        fontWeight: 'bold',
        fontSize: 28,
        color: colors.text,
        marginBottom: 2,
        textAlign: 'center',
        letterSpacing: 0.5,
    },
    oxyPayWaiting: {
        fontSize: 14,
        color: colors.secondaryText,
        textAlign: 'center',
        marginBottom: 8,
    },
    faircoinContainer: {
        alignItems: 'center',
        marginBottom: 24,
        width: '100%',
    },
    faircoinIcon: {
        marginBottom: 8,
    },
    faircoinMainTitle: {
        fontFamily: fontFamilies.phuduBold,
        fontWeight: 'bold',
        fontSize: 28,
        color: '#1b1f0a',
        marginBottom: 2,
        textAlign: 'center',
        letterSpacing: 0.5,
    },
    faircoinSubtitle: {
        color: '#1b1f0a',
        fontWeight: '700',
        fontSize: 17,
        marginBottom: 18,
        textAlign: 'center',
        letterSpacing: 0.2,
    },
    faircoinScanText: {
        color: '#1b1f0a',
        fontWeight: '600',
        fontSize: 15,
        marginBottom: 8,
    },
    faircoinQRCard: {
        width: 200,
        height: 200,
        backgroundColor: '#fff',
        borderRadius: 32,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
        padding: 16,
        borderWidth: 3,
        borderColor: '#9ffb50',
        shadowColor: '#9ffb50',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 8,
        position: 'relative',
    },
    faircoinQRBadge: {
        position: 'absolute',
        bottom: 12,
        right: 12,
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    faircoinTitle: {
        fontSize: 16,
        marginBottom: 8,
        color: colors.text,
        fontWeight: '600',
        textAlign: 'center',
    },
    faircoinQRBox: {
        width: 160,
        height: 160,
        backgroundColor: '#eee',
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 12,
        borderWidth: 2,
        borderColor: colors.primary,
    },
    faircoinQRText: {
        color: '#aaa',
    },
    faircoinWaiting: {
        fontSize: 14,
        color: colors.secondaryText,
        textAlign: 'center',
        marginBottom: 8,
    },
    faircoinPlaceholder: {
        fontSize: 13,
        color: colors.secondaryText,
        textAlign: 'center',
    },
    faircoinCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 24,
        marginBottom: 24,
        alignItems: 'center',
        width: '100%',
    },
    faircoinContent: {
        alignItems: 'center',
        width: '100%',
    },

    successCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 24,
        marginBottom: 24,
        alignItems: 'center',
        width: '100%',
    },
    successContent: {
        alignItems: 'center',
        width: '100%',
    },
    successIcon: {
        marginBottom: 8,
    },
    successMainTitle: {
        fontFamily: fontFamilies.phuduBold,
        fontWeight: 'bold',
        fontSize: 28,
        color: colors.success || '#4BB543',
        marginBottom: 2,
        textAlign: 'center',
        letterSpacing: 0.5,
    },
    successSubtitle: {
        fontSize: 16,
        color: colors.text,
        textAlign: 'center',
        marginBottom: 8,
        width: '100%',
    },
    successMessage: {
        fontSize: 14,
        color: colors.secondaryText,
        textAlign: 'center',
        marginBottom: 8,
    },
    methodCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 18,
        paddingVertical: 18,
        paddingHorizontal: 18,
        marginBottom: 14,
        borderWidth: 1.5,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 2,
        minHeight: 72,
    },
    methodCardSelected: {
        backgroundColor: colors.primary + '11',
        borderColor: colors.primary,
        shadowOpacity: 0.13,
        shadowRadius: 10,
        elevation: 4,
    },
    methodCardContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    methodCardIcon: {
        marginRight: 18,
        marginLeft: 2,
    },
    methodCardTextContainer: {
        flex: 1,
        flexDirection: 'column',
        justifyContent: 'center',
    },
    methodCardDescription: {
        fontSize: 14,
        color: colors.secondaryText,
        marginTop: 2,
        opacity: 0.85,
    },
    methodCardCheckIcon: {
        marginLeft: 12,
    },
    paymentMethodLabelSelected: {
        color: colors.primary,
    },
    circleListContainer: {
        flexDirection: 'row',
        flexWrap: 'nowrap',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingHorizontal: 4,
        width: '100%',
        marginBottom: 0,
    },
    circleMethod: {
        alignItems: 'center',
        marginHorizontal: 0,
        flex: 1,
        minWidth: 62,
        paddingVertical: 2,
        paddingHorizontal: 2,
    },
    circleMethodSelected: {
        // No extra margin, but highlight below
    },
    circleIconWrapper: {
        width: 48, // restored padding
        height: 48, // restored padding
        borderRadius: 24, // half of width/height
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8, // spacing below icon
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 6,
        elevation: 2,
    },
    circleLabel: {
        fontFamily: fontFamilies.phudu,
        fontSize: 16,
        color: colors.text,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 4,
        marginTop: 2,
    },
    circleLabelSelected: {
        color: colors.primary,
    },
    circleDescription: {
        fontSize: 13,
        color: colors.secondaryText,
        textAlign: 'center',
        opacity: 0.85,
        minHeight: 36,
        marginBottom: 2,
    },

    headerStepIndicatorContainer: {
        marginVertical: 2,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    faircoinButton: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        backgroundColor: colors.primary + '11',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 8,
        marginTop: 6,
        marginBottom: 2,
    },
    faircoinButtonText: {
        color: colors.primary,
        fontWeight: '600',
        fontSize: 15,
    },
    faircoinAddress: {
        color: colors.secondaryText,
        fontSize: 13,
        textAlign: 'center',
        marginTop: 6,
        marginBottom: 2,
    },

    // Summary step styles
    summaryDescriptionContainer: {
        marginBottom: 16,
    },
    summaryDescriptionText: {
        color: colors.secondaryText,
        fontSize: 15,
        lineHeight: 20,
    },
    summaryItemPrice: {
        color: colors.text,
        fontWeight: '600',
        fontSize: 16,
    },
    summaryFallbackContainer: {
        padding: 16,
        backgroundColor: '#fff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    summaryFallbackText: {
        color: colors.text,
        fontSize: 16,
        textAlign: 'center',
    },
    // Card payment styles
    cardPaymentCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 24,
        marginBottom: 24,
        alignItems: 'center',
        width: '100%',
    },
    cardPaymentContent: {
        alignItems: 'center',
        width: '100%',
    },
    cardPaymentIcon: {
        marginBottom: 8,
    },
    cardPaymentMainTitle: {
        fontFamily: fontFamilies.phuduBold,
        fontWeight: 'bold',
        fontSize: 28,
        color: colors.text,
        marginBottom: 2,
        textAlign: 'center',
        letterSpacing: 0.5,
    },
    cardPaymentSubtitle: {
        fontSize: 16,
        color: colors.secondaryText,
        textAlign: 'center',
        marginBottom: 24,
        width: '100%',
    },
    cardPaymentFields: {
        width: '100%',
        marginBottom: 16,
    },
    cardPaymentWaiting: {
        fontSize: 14,
        color: colors.secondaryText,
        textAlign: 'center',
        marginBottom: 8,
    },
    // Summary card styles
    summaryCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 24,
        marginBottom: 24,
        alignItems: 'center',
        width: '100%',
    },
    summaryCardContent: {
        alignItems: 'center',
        width: '100%',
    },
    summaryCardIcon: {
        marginBottom: 8,
    },
    summaryCardMainTitle: {
        fontFamily: fontFamilies.phuduBold,
        fontWeight: 'bold',
        fontSize: 28,
        color: colors.text,
        marginBottom: 2,
        textAlign: 'center',
        letterSpacing: 0.5,
    },
    summaryCardSubtitle: {
        fontSize: 16,
        color: colors.secondaryText,
        textAlign: 'center',
        marginBottom: 24,
        width: '100%',
    },
    summaryCardItems: {
        width: '100%',
        marginBottom: 16,
    },
    summaryCardTotal: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.text,
        textAlign: 'center',
        marginBottom: 8,
    },
    // Simple amount styles
    summaryCardAmount: {
        alignItems: 'center',
        width: '100%',
        marginBottom: 16,
    },
    summaryCardAmountLabel: {
        fontSize: 16,
        color: colors.secondaryText,
        textAlign: 'center',
        marginBottom: 8,
    },
    summaryCardAmountValue: {
        fontSize: 32,
        fontWeight: 'bold',
        color: colors.text,
        textAlign: 'center',
        marginBottom: 8,
        fontFamily: fontFamilies.phuduBold,
    },
    summaryCardAmountDescription: {
        fontSize: 14,
        color: colors.secondaryText,
        textAlign: 'center',
        lineHeight: 20,
    },
    // Enhanced summary styles
    summaryCardDivider: {
        height: 1,
        backgroundColor: colors.border,
        marginVertical: 16,
        width: '100%',
    },
    summaryCardTotalSection: {
        width: '100%',
        marginBottom: 8,
    },
    summaryCardTotalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 4,
    },
    summaryCardTotalLabel: {
        fontSize: 16,
        color: colors.secondaryText,
        fontWeight: '500',
    },
    summaryCardTotalValue: {
        fontSize: 16,
        color: colors.text,
        fontWeight: '600',
    },
});

export default PaymentGatewayScreen; 
