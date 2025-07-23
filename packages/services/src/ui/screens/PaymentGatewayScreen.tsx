import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
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
import { BaseScreenProps } from '../navigation/types';
import { fontFamilies, useThemeColors, createCommonStyles } from '../styles';
import OxyLogo from '../components/OxyLogo';
import GroupedPillButtons from '../components/internal/GroupedPillButtons';
import TextField from '../components/internal/TextField';
import { Ionicons } from '@expo/vector-icons';
import { FAIRWalletIcon } from '../components/icon';
import { toast } from 'sonner';
import QRCode from 'react-native-qrcode-svg';
import * as RNIap from 'react-native-iap';

// Restrict payment methods to Card, Oxy Pay, and FairCoin (QR)
const PAYMENT_METHODS = [
    { key: 'card', label: 'Credit/Debit Card', icon: 'card-outline', description: 'Pay securely with your credit or debit card.' },
    { key: 'oxy', label: 'Oxy Pay', icon: 'wallet-outline', description: 'Use your Oxy Pay in-app balance.' },
    { key: 'faircoin', label: 'FAIRWallet', icon: 'qr-code-outline', description: 'Pay with FairCoin by scanning a QR code.' },
];

// Add Google Play Billing to payment methods if Android
const ANDROID_IAP_METHOD = {
    key: 'googleplay',
    label: 'Google Play Billing',
    icon: 'logo-google-playstore',
    description: 'Pay securely with your Google Play account.'
};
if (Platform.OS === 'android' && !PAYMENT_METHODS.find(m => m.key === 'googleplay')) {
    PAYMENT_METHODS.push(ANDROID_IAP_METHOD);
}

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
interface PaymentGatewayResult {
    success: boolean;
    details?: any;
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

const IAP_PRODUCT_IDS = ['test_product_1', 'test_product_2']; // TODO: Replace with real product IDs

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

    // IAP state
    const [iapProducts, setIapProducts] = useState<RNIap.Product[]>([]);
    const [iapError, setIapError] = useState<string | null>(null);
    const [iapLoading, setIapLoading] = useState(false);
    const [iapPurchase, setIapPurchase] = useState<RNIap.Purchase | null>(null);

    // Animations
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const progressAnim = useRef(new Animated.Value(0.2)).current;

    const colors = useThemeColors(theme);
    const commonStyles = createCommonStyles(theme);
    const styles = useMemo(() => createStyles(colors, theme), [colors, theme]);

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
    }, [fadeAnim, slideAnim, scaleAnim]);

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
        navigate('AccountOverviewScreen');
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
                    colors={useThemeColors(theme)}
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

    // IAP setup (Android only)
    useEffect(() => {
        if (paymentMethod !== 'googleplay' || Platform.OS !== 'android') return;
        let purchaseUpdateSub: any, purchaseErrorSub: any;
        setIapLoading(true);
        RNIap.initConnection()
            .then(() => RNIap.getProducts({ skus: IAP_PRODUCT_IDS }))
            .then(setIapProducts)
            .catch(e => setIapError(e.message))
            .finally(() => setIapLoading(false));
        purchaseUpdateSub = RNIap.purchaseUpdatedListener((purchase) => {
            setIapPurchase(purchase);
            setSuccess(true);
            nextStep();
        });
        purchaseErrorSub = RNIap.purchaseErrorListener((err) => {
            setIapError(err.message);
        });
        return () => {
            purchaseUpdateSub && purchaseUpdateSub.remove();
            purchaseErrorSub && purchaseErrorSub.remove();
            RNIap.endConnection();
        };
    }, [paymentMethod]);

    const handleIapBuy = async (sku: string) => {
        setIapError(null);
        setIapLoading(true);
        try {
            await RNIap.requestPurchase({ sku });
        } catch (e: any) {
            setIapError(e.message);
        } finally {
            setIapLoading(false);
        }
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
    const PaymentGatewayHeader: React.FC<{ currentStep: number; totalSteps: number; title: string; }> = ({ currentStep, totalSteps, title }) => (
        <View style={styles.headerWrapper}>
            <OxyLogo style={styles.logo} />
            <Text style={styles.headerTitle}>{title}</Text>
            <View style={styles.headerStepIndicatorContainer}>
                {Array.from({ length: totalSteps }).map((_, idx) => (
                    <View
                        key={idx}
                        style={getStepIndicatorStyle(currentStep + 1 === idx + 1)}
                    />
                ))}
            </View>
        </View>
    );

    // Card container for main content
    const Card: React.FC<{ children: React.ReactNode; style?: any }> = ({ children, style }) => (
        <View style={[styles.card, style]}>
            {children}
        </View>
    );

    // Product/Item summary card for step 1
    const renderItemSummary = () => {
        if (paymentItems && paymentItems.length > 0) {
            return (
                <Card style={{ marginBottom: 10 }}>
                    {paymentItems.map((item, idx) => (
                        <View key={idx} style={{ marginBottom: 8 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Text style={{ fontWeight: '600', color: colors.text }}>
                                    {item.type === 'product' && item.quantity ? `${item.quantity} × ` : ''}
                                    {item.name}
                                    {item.type === 'subscription' && item.period ? ` (${item.period})` : ''}
                                </Text>
                                <Text style={{ color: colors.text }}>
                                    {(item.currency ? (CURRENCY_SYMBOLS[item.currency.toUpperCase()] || item.currency) : currencySymbol)} {item.price * (item.quantity ?? 1)}
                                </Text>
                            </View>
                            {item.description ? (
                                <Text style={{ color: colors.secondaryText, fontSize: 13 }}>{item.description}</Text>
                            ) : null}
                        </View>
                    ))}
                    <View style={{ borderTopWidth: 1, borderColor: colors.border, marginTop: 8, paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontWeight: '700', color: colors.text }}>Total</Text>
                        <Text style={{ fontWeight: '700', color: colors.primary, fontSize: 18 }}>{currencySymbol} {computedTotal}</Text>
                    </View>
                </Card>
            );
        } else if (description) {
            return (
                <Card style={{ marginBottom: 10 }}>
                    <Text style={{ color: colors.text }}>{description}</Text>
                    <View style={{ borderTopWidth: 1, borderColor: colors.border, marginTop: 8, paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontWeight: '700', color: colors.text }}>Total</Text>
                        <Text style={{ fontWeight: '700', color: colors.primary, fontSize: 18 }}>{currencySymbol} {computedTotal}</Text>
                    </View>
                </Card>
            );
        }
        return null;
    };

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
            <Card>
                <Text style={{ color: colors.secondaryText, fontSize: 15, marginBottom: 16 }}>You're about to pay for the following:</Text>
                {paymentItems && paymentItems.length > 0 ? paymentItems.map((item, idx) => (
                    <View key={idx} style={{ marginBottom: 12, flexDirection: 'row', alignItems: 'flex-start' }}>
                        {getItemTypeIcon(item.type, colors.primary)}
                        <View style={{ flex: 1 }}>
                            <Text style={{ fontWeight: '600', color: colors.text, fontSize: 16 }}>
                                {item.type === 'product' && item.quantity ? `${item.quantity} × ` : ''}
                                {item.name}
                                {item.type === 'subscription' && item.period ? ` (${item.period})` : ''}
                            </Text>
                            {item.description ? (
                                <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 2 }}>{item.description}</Text>
                            ) : null}
                        </View>
                        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 16, marginLeft: 8 }}>
                            {(item.currency ? (CURRENCY_SYMBOLS[item.currency.toUpperCase()] || item.currency) : currencySymbol)} {item.price * (item.quantity ?? 1)}
                        </Text>
                    </View>
                )) : (
                    <Text style={{ color: colors.text }}>{description}</Text>
                )}
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
            </Card>
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
            <Card>
                <View style={styles.circleListContainer}>
                    {availablePaymentMethods.map(method => {
                        const isSelected = paymentMethod === method.key;
                        return (
                            <TouchableOpacity
                                key={method.key}
                                onPress={() => setPaymentMethod(method.key)}
                                activeOpacity={0.85}
                                style={[styles.circleMethod, isSelected && styles.circleMethodSelected]}
                            >
                                <View style={styles.circleIconWrapper}>
                                    {method.key === 'faircoin' ? (
                                        <FAIRWalletIcon size={28} />
                                    ) : (
                                        <Ionicons
                                            name={method.icon as any}
                                            size={28}
                                            color={isSelected ? colors.primary : colors.text}
                                        />
                                    )}
                                    {isSelected && (
                                        <View style={styles.circleCheckOverlay}>
                                            <Ionicons name="checkmark-circle" size={28} color={colors.primary} />
                                        </View>
                                    )}
                                </View>
                                <Text style={[styles.circleLabel, isSelected && styles.circleLabelSelected]}>{method.label}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </Card>
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
            <Card
                style={paymentMethod === 'faircoin' ? { backgroundColor: '#f6fff0', paddingVertical: 24, paddingHorizontal: 0 } : undefined}
            >
                {paymentMethod === 'card' && (
                    <>
                        <View style={styles.cardRowInfo}>
                            <Ionicons name="card-outline" size={24} color={colors.primary} style={styles.cardRowIcon} />
                            <Text style={styles.cardRowText}>We accept Visa, Mastercard, and more</Text>
                        </View>
                        <TextField
                            value={cardDetails.number}
                            onChangeText={text => setCardDetails({ ...cardDetails, number: text })}
                            placeholder="Card Number"
                            keyboardType="numeric"
                            style={styles.cardFieldContainer}
                            leading={<Ionicons name="card-outline" size={18} color={colors.primary} />}
                        />
                        <View style={styles.cardFieldRow}>
                            <TextField
                                value={cardDetails.expiry}
                                onChangeText={text => setCardDetails({ ...cardDetails, expiry: text })}
                                placeholder="MM/YY"
                                style={styles.cardFieldHalfLeft}
                                leading={<Ionicons name="calendar-outline" size={16} color={colors.primary} />}
                            />
                            <TextField
                                value={cardDetails.cvv}
                                onChangeText={text => setCardDetails({ ...cardDetails, cvv: text })}
                                placeholder="CVV"
                                keyboardType="numeric"
                                style={styles.cardFieldHalfRight}
                                leading={<Ionicons name="lock-closed-outline" size={16} color={colors.primary} />}
                            />
                        </View>
                    </>
                )}
                {paymentMethod === 'oxy' && (
                    <View style={styles.oxyPayContainer}>
                        <Ionicons name="wallet-outline" size={48} color={colors.primary} style={styles.oxyPayIcon} />
                        <Text style={styles.oxyPayTitle}>Pay with Oxy Pay</Text>
                        <Text style={styles.oxyPaySubtitle}>(Oxy Pay is your in-app wallet. Make sure you have enough balance.)</Text>
                        <View style={styles.oxyPayBalanceBox}>
                            <Text style={styles.oxyPayBalanceText}>Balance: ⊜ 123.45</Text>
                        </View>
                    </View>
                )}
                {paymentMethod === 'faircoin' && (
                    <View style={{ alignItems: 'center', width: '100%' }}>
                        <FAIRWalletIcon size={64} style={[styles.faircoinIcon, { shadowColor: '#1b1f0a', shadowOpacity: 0.18, shadowRadius: 12, elevation: 6, marginBottom: 12 }]} />
                        <Text style={{ fontFamily: fontFamilies.phuduBold, fontWeight: 'bold', fontSize: 28, color: '#1b1f0a', marginBottom: 2, textAlign: 'center', letterSpacing: 0.5 }}>FAIRWallet</Text>
                        <Text style={{ color: '#1b1f0a', fontWeight: '700', fontSize: 17, marginBottom: 18, textAlign: 'center', letterSpacing: 0.2 }}>Pay with FairCoin</Text>
                        {!isMobile ? (
                            <>
                                <Text style={{ color: '#1b1f0a', fontWeight: '600', fontSize: 15, marginBottom: 8 }}>Scan to Pay</Text>
                                <View style={[styles.faircoinQRBox, { width: qrSize, height: qrSize, borderColor: '#9ffb50', borderWidth: 3, position: 'relative', backgroundColor: '#fff', boxShadow: '0 2px 12px #9ffb5040', justifyContent: 'center', alignItems: 'center' }]}>
                                    <QRCode value={faircoinAddress} size={qrSize - 32} />
                                    <View style={{ position: 'absolute', bottom: 8, right: 8 }}>
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
                        <Text style={styles.faircoinPlaceholder}>(This is a placeholder. Integrate with a QR code generator for production.)</Text>
                    </View>
                )}
            </Card>
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
            <Card>
                <View style={styles.reviewSecureRow}>
                    <Ionicons name="shield-checkmark" size={20} color={colors.success || '#4BB543'} style={styles.reviewSecureIcon} />
                    <Text style={styles.reviewSecureText}>Secure payment</Text>
                </View>
                <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Amount</Text>
                    <Text style={styles.reviewValue}>{currencySymbol} {amount}</Text>
                </View>
                <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Method</Text>
                    <View style={styles.reviewMethodRow}>
                        <Ionicons name={PAYMENT_METHODS.find(m => m.key === paymentMethod)?.icon as any} size={18} color={colors.primary} style={styles.reviewMethodIcon} />
                        <Text style={styles.reviewMethodText}>{PAYMENT_METHODS.find(m => m.key === paymentMethod)?.label}</Text>
                    </View>
                </View>
                {paymentMethod === 'card' && (
                    <View style={styles.reviewRow}>
                        <Text style={styles.reviewLabel}>Card</Text>
                        <Text style={styles.reviewValue}>{cardDetails.number.replace(/.(?=.{4})/g, '*')}</Text>
                    </View>
                )}
                {paymentMethod === 'oxy' && (
                    <View style={styles.reviewRow}>
                        <Text style={styles.reviewLabel}>Oxy Pay Account</Text>
                        <Text style={styles.reviewValue}>Balance: ⊜ 123.45</Text>
                    </View>
                )}
                {paymentMethod === 'faircoin' && (
                    <View style={styles.reviewRow}>
                        <Text style={styles.reviewLabel}>FairCoin Wallet</Text>
                        <Text style={styles.reviewValue}>Paid via QR</Text>
                    </View>
                )}
            </Card>
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
            <View style={styles.successContainer}>
                <View style={styles.successIconBox}>
                    <Ionicons name="checkmark-circle" size={64} color={colors.success || '#4BB543'} />
                </View>
                <Text style={styles.successTitle}>Payment Successful!</Text>
                <Text style={styles.successSubtitle}>Thank you for your payment.</Text>
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

    // Step: Google Play Billing (Android only)
    const renderGooglePlayStep = () => (
        <Animated.View style={[styles.stepContainer, {
            opacity: fadeAnim,
            transform: [
                { translateY: slideAnim },
                { scale: scaleAnim },
            ]
        }]}
        >
            <Card>
                <Text style={{ color: colors.text, fontWeight: '600', fontSize: 16, marginBottom: 12 }}>Select a product to purchase:</Text>
                {iapLoading && <Text style={{ color: colors.secondaryText }}>Loading products...</Text>}
                {iapError && <Text style={{ color: 'red' }}>{iapError}</Text>}
                {iapProducts.map(product => (
                    <TouchableOpacity
                        key={product.productId}
                        style={[styles.paymentMethodButton, { marginBottom: 8 }]}
                        onPress={() => handleIapBuy(product.productId)}
                        disabled={iapLoading}
                    >
                        <Text style={{ color: colors.text, fontSize: 16 }}>{product.title} - {product.localizedPrice}</Text>
                    </TouchableOpacity>
                ))}
                {iapPurchase && (
                    <Text style={{ color: colors.success, marginTop: 10 }}>Purchase successful!</Text>
                )}
            </Card>
            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Back',
                        onPress: prevStep,
                        icon: 'arrow-back',
                        variant: 'transparent',
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
            case 2:
                if (paymentMethod === 'googleplay') return renderGooglePlayStep();
                return renderDetailsStep();
            case 3: return renderReviewStep();
            case 4: return renderSuccessStep();
            default: return renderSummaryStep();
        }
    };

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <StatusBar
                barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />
            <PaymentGatewayHeader
                currentStep={currentStep}
                totalSteps={5}
                title={stepTitles[currentStep]}
            />
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {renderCurrentStep()}
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const createStyles = (colors: any, theme: string) => StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingBottom: 20,
    },
    stepContainer: {
        flex: 1,
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        width: '100%',
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
    headerWrapper: {
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        gap: 8,
        paddingVertical: 8,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 28,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
        marginVertical: 8,
        width: '100%',
        alignSelf: 'center',
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
    faircoinContainer: {
        alignItems: 'center',
        marginBottom: 24,
        width: '100%',
    },
    faircoinIcon: {
        marginBottom: 8,
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
    reviewSecureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    reviewSecureIcon: {
        marginRight: 8,
    },
    reviewSecureText: {
        color: colors.success || '#4BB543',
        fontWeight: '600',
        fontSize: 15,
    },
    reviewRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    reviewLabel: {
        fontSize: 15,
        color: colors.secondaryText,
    },
    reviewValue: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
    },
    reviewMethodRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    reviewMethodIcon: {
        marginRight: 6,
    },
    reviewMethodText: {
        fontSize: 16,
        color: colors.text,
    },
    successContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
        width: '100%',
    },
    successIconBox: {
        backgroundColor: colors.success + '22',
        borderRadius: 48,
        padding: 18,
        marginBottom: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    successTitle: {
        fontSize: 26,
        fontWeight: '700',
        color: colors.success || '#4BB543',
        marginBottom: 8,
        textAlign: 'center',
        width: '100%',
    },
    successSubtitle: {
        fontSize: 16,
        color: colors.text,
        textAlign: 'center',
        marginBottom: 8,
        width: '100%',
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
    circleCheckOverlay: {
        position: 'absolute',
        bottom: -8,
        right: -8,
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 0,
        zIndex: 2,
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
});

export default PaymentGatewayScreen; 