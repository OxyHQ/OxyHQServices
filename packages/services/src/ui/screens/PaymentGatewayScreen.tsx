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
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { fontFamilies, useThemeColors, createCommonStyles } from '../styles';
import OxyLogo from '../components/OxyLogo';
import GroupedPillButtons from '../components/internal/GroupedPillButtons';
import TextField from '../components/internal/TextField';
import { Ionicons } from '@expo/vector-icons';

// Restrict payment methods to Card, Oxy Pay, and FairCoin (QR)
const PAYMENT_METHODS = [
    { key: 'card', label: 'Credit/Debit Card', icon: 'card-outline', description: 'Pay securely with your credit or debit card.' },
    { key: 'oxy', label: 'Oxy Pay', icon: 'wallet-outline', description: 'Use your Oxy Pay in-app balance.' },
    { key: 'faircoin', label: 'FairCoin (Scan QR)', icon: 'qr-code-outline', description: 'Pay with FairCoin by scanning a QR code.' },
];

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

const PaymentGatewayScreen: React.FC<PaymentGatewayScreenProps> = ({
    navigate,
    goBack,
    theme,
    onPaymentResult,
    amount,
    currency = 'FAIR',
    onClose,
}) => {
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

    const colors = useThemeColors(theme);
    const commonStyles = createCommonStyles(theme);
    const styles = useMemo(() => createStyles(colors, theme), [colors, theme]);

    // Get symbol and name for currency
    const currencySymbol = CURRENCY_SYMBOLS[currency.toUpperCase()] || currency;
    const currencyName = CURRENCY_NAMES[currency.toUpperCase()] || currency;

    // Animation transitions
    const animateTransition = useCallback((nextStep: number) => {
        Animated.timing(scaleAnim, {
            toValue: 0.95,
            duration: 150,
            useNativeDriver: true,
        }).start();
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
        }).start(() => {
            setCurrentStep(nextStep);
            slideAnim.setValue(-50);
            scaleAnim.setValue(0.95);
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }),
                Animated.spring(slideAnim, {
                    toValue: 0,
                    tension: 80,
                    friction: 8,
                    useNativeDriver: true,
                }),
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    tension: 80,
                    friction: 8,
                    useNativeDriver: true,
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
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
                <Text style={{ fontSize: 18, color: 'red', marginBottom: 24 }}>Invalid or missing payment amount.</Text>
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

    // Step indicator
    const renderStepIndicator = () => {
        const totalSteps = 4;
        const activeStep = currentStep + 1;
        return (
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginVertical: 16 }}>
                {Array.from({ length: totalSteps }).map((_, idx) => (
                    <View
                        key={idx}
                        style={{
                            width: activeStep === idx + 1 ? 28 : 10,
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: activeStep === idx + 1 ? colors.primary : colors.border,
                            marginHorizontal: 4,
                            // transition: 'width 0.2s', // Removed, not supported in React Native
                        }}
                    />
                ))}
            </View>
        );
    };

    // Header with logo and title
    const renderHeader = () => (
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
            <OxyLogo style={{ height: 48, marginBottom: 8 }} />
            <Text style={{
                fontFamily: fontFamilies.phuduBold,
                fontSize: 36,
                fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
                color: colors.text,
                letterSpacing: -1,
                marginBottom: 8,
            }}>Complete Your Payment</Text>
        </View>
    );

    // Card container for main content
    const Card: React.FC<{ children: React.ReactNode; style?: any }> = ({ children, style }) => (
        <View style={{
            backgroundColor: colors.inputBackground,
            borderRadius: 20,
            padding: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.08,
            shadowRadius: 8,
            elevation: 3,
            marginVertical: 8,
            width: '100%',
            alignSelf: 'center',
            ...style,
        }}>
            {children}
        </View>
    );

    // Amount pill
    const AmountPill = () => (
        <View style={{ alignSelf: 'center', backgroundColor: colors.primary + '22', borderRadius: 32, paddingHorizontal: 32, paddingVertical: 12, marginBottom: 18, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{
                fontFamily: fontFamilies.phuduBold,
                fontSize: 38,
                fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
                color: colors.primary,
                letterSpacing: -1,
                marginRight: 6,
                textAlign: 'center',
                width: '100%',
            }}>{currencySymbol} {amount}</Text>
        </View>
    );

    // Step 1: Choose Payment Method (now the first step)
    const renderMethodStep = () => (
        <Animated.View style={[styles.stepContainer, {
            opacity: fadeAnim,
            transform: [
                { translateY: slideAnim },
                { scale: scaleAnim },
            ]
        }]}
        >
            {renderHeader()}
            {renderStepIndicator()}
            <AmountPill />
            <Card>
                <Text style={{
                    fontFamily: fontFamilies.phuduBold,
                    fontSize: 24,
                    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
                    color: colors.text,
                    marginBottom: 12,
                    letterSpacing: -0.5,
                    textAlign: 'left',
                }}>Select Payment Method</Text>
                <View style={{ width: '100%', alignItems: 'center' }}>
                    {PAYMENT_METHODS.map(method => (
                        <TouchableOpacity
                            key={method.key}
                            onPress={() => setPaymentMethod(method.key)}
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                backgroundColor: paymentMethod === method.key ? colors.primary + '22' : 'transparent',
                                borderRadius: 16,
                                padding: 14,
                                marginBottom: 10,
                                borderWidth: paymentMethod === method.key ? 2 : 1,
                                borderColor: paymentMethod === method.key ? colors.primary : colors.border,
                                width: '90%',
                                alignSelf: 'center',
                            }}
                        >
                            <Ionicons name={method.icon as any} size={22} color={paymentMethod === method.key ? colors.primary : colors.text} style={{ marginRight: 12 }} />
                            <Text style={{
                                fontFamily: fontFamilies.phudu,
                                fontSize: 18,
                                color: colors.text,
                                fontWeight: '600',
                            }}>{method.label}</Text>
                            {paymentMethod === method.key && (
                                <Ionicons name="checkmark-circle" size={20} color={colors.primary} style={{ marginLeft: 'auto' }} />
                            )}
                        </TouchableOpacity>
                    ))}
                </View>
                <Text style={{
                    fontFamily: fontFamilies.phudu,
                    fontSize: 15,
                    color: colors.secondaryText,
                    marginTop: 8,
                    minHeight: 36,
                    textAlign: 'center',
                }}>
                    {PAYMENT_METHODS.find(m => m.key === paymentMethod)?.description}
                </Text>
            </Card>
            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Continue',
                        onPress: nextStep,
                        icon: 'arrow-forward',
                        variant: 'primary',
                    },
                ]}
                colors={colors}
            />
            <TouchableOpacity onPress={handleClose} style={{ alignSelf: 'center', marginTop: 24 }}>
                <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '500' }}>Close</Text>
            </TouchableOpacity>
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
            {renderHeader()}
            {renderStepIndicator()}
            <AmountPill />
            <Card>
                <Text style={{
                    fontFamily: fontFamilies.phuduBold,
                    fontSize: 24,
                    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
                    color: colors.text,
                    marginBottom: 12,
                    letterSpacing: -0.5,
                    textAlign: 'left',
                }}>
                    {paymentMethod === 'card' ? 'Card Details' : paymentMethod === 'oxy' ? 'Oxy Pay Confirmation' : 'Scan FairCoin QR'}
                </Text>
                {paymentMethod === 'card' && (
                    <>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                            <Ionicons name="card-outline" size={24} color={colors.primary} style={{ marginRight: 8 }} />
                            <Text style={{ fontSize: 15, color: colors.secondaryText }}>We accept Visa, Mastercard, and more</Text>
                        </View>
                        <TextField
                            value={cardDetails.number}
                            onChangeText={text => setCardDetails({ ...cardDetails, number: text })}
                            placeholder="Card Number"
                            keyboardType="numeric"
                            containerStyle={{ marginBottom: 16 }}
                            leftComponent={<Ionicons name="card-outline" size={18} color={colors.primary} />}
                        />
                        <View style={{ flexDirection: 'row', gap: 12 }}>
                            <TextField
                                value={cardDetails.expiry}
                                onChangeText={text => setCardDetails({ ...cardDetails, expiry: text })}
                                placeholder="MM/YY"
                                containerStyle={{ flex: 1, marginRight: 6 }}
                                leftComponent={<Ionicons name="calendar-outline" size={16} color={colors.primary} />}
                            />
                            <TextField
                                value={cardDetails.cvv}
                                onChangeText={text => setCardDetails({ ...cardDetails, cvv: text })}
                                placeholder="CVV"
                                keyboardType="numeric"
                                containerStyle={{ flex: 1, marginLeft: 6 }}
                                leftComponent={<Ionicons name="lock-closed-outline" size={16} color={colors.primary} />}
                            />
                        </View>
                    </>
                )}
                {paymentMethod === 'oxy' && (
                    <View style={{ alignItems: 'center', marginBottom: 24 }}>
                        <Ionicons name="wallet-outline" size={48} color={colors.primary} style={{ marginBottom: 8 }} />
                        <Text style={{ fontSize: 16, marginBottom: 8, color: colors.text, fontWeight: '600', textAlign: 'center' }}>
                            Pay with Oxy Pay
                        </Text>
                        <Text style={{ fontSize: 14, color: colors.secondaryText, marginBottom: 8, textAlign: 'center' }}>
                            (Oxy Pay is your in-app wallet. Make sure you have enough balance.)
                        </Text>
                        <View style={{ backgroundColor: colors.primary + '22', borderRadius: 12, padding: 8, marginTop: 8 }}>
                            <Text style={{ color: colors.primary, fontWeight: '600' }}>Balance: ⊜ 123.45</Text>
                        </View>
                    </View>
                )}
                {paymentMethod === 'faircoin' && (
                    <View style={{ alignItems: 'center', marginBottom: 24, width: '100%' }}>
                        <Ionicons name="qr-code-outline" size={48} color={colors.primary} style={{ marginBottom: 8 }} />
                        <Text style={{ fontSize: 16, marginBottom: 8, color: colors.text, fontWeight: '600', textAlign: 'center' }}>
                            Scan this QR code with your FairCoin wallet app
                        </Text>
                        <View style={{ width: 160, height: 160, backgroundColor: '#eee', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 12, borderWidth: 2, borderColor: colors.primary }}>
                            <Text style={{ color: '#aaa' }}>[QR CODE]</Text>
                        </View>
                        <Text style={{ fontSize: 14, color: colors.secondaryText, textAlign: 'center', marginBottom: 8 }}>
                            Waiting for payment...
                        </Text>
                        <Text style={{ fontSize: 13, color: colors.secondaryText, textAlign: 'center' }}>
                            (This is a placeholder. Integrate with a QR code generator for production.)
                        </Text>
                    </View>
                )}
            </Card>
            <GroupedPillButtons
                buttons={[
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
            {renderHeader()}
            {renderStepIndicator()}
            <AmountPill />
            <Card>
                <Text style={{
                    fontFamily: fontFamilies.phuduBold,
                    fontSize: 24,
                    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
                    color: colors.text,
                    marginBottom: 12,
                    letterSpacing: -0.5,
                    textAlign: 'left',
                }}>Review Payment</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                    <Ionicons name="shield-checkmark" size={20} color={colors.success || '#4BB543'} style={{ marginRight: 8 }} />
                    <Text style={{ color: colors.success || '#4BB543', fontWeight: '600', fontSize: 15 }}>Secure payment</Text>
                </View>
                <View style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 15, color: colors.secondaryText }}>Amount</Text>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{currencySymbol} {amount}</Text>
                </View>
                <View style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 15, color: colors.secondaryText }}>Method</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name={PAYMENT_METHODS.find(m => m.key === paymentMethod)?.icon as any} size={18} color={colors.primary} style={{ marginRight: 6 }} />
                        <Text style={{ fontSize: 16, color: colors.text }}>{PAYMENT_METHODS.find(m => m.key === paymentMethod)?.label}</Text>
                    </View>
                </View>
                {paymentMethod === 'card' && (
                    <View style={{ marginBottom: 8 }}>
                        <Text style={{ fontSize: 15, color: colors.secondaryText }}>Card</Text>
                        <Text style={{ fontSize: 16, color: colors.text }}>{cardDetails.number.replace(/.(?=.{4})/g, '*')}</Text>
                    </View>
                )}
                {paymentMethod === 'oxy' && (
                    <View style={{ marginBottom: 8 }}>
                        <Text style={{ fontSize: 15, color: colors.secondaryText }}>Oxy Pay Account</Text>
                        <Text style={{ fontSize: 16, color: colors.text }}>Balance: ⊜ 123.45</Text>
                    </View>
                )}
                {paymentMethod === 'faircoin' && (
                    <View style={{ marginBottom: 8 }}>
                        <Text style={{ fontSize: 15, color: colors.secondaryText }}>FairCoin Wallet</Text>
                        <Text style={{ fontSize: 16, color: colors.text }}>Paid via QR</Text>
                    </View>
                )}
            </Card>
            <GroupedPillButtons
                buttons={[
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
            <View style={{ alignItems: 'center', justifyContent: 'center', marginBottom: 24, width: '100%' }}>
                <View style={{ backgroundColor: colors.success + '22', borderRadius: 48, padding: 18, marginBottom: 12, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="checkmark-circle" size={64} color={colors.success || '#4BB543'} />
                </View>
                <Text style={{ fontSize: 26, fontWeight: '700', color: colors.success || '#4BB543', marginBottom: 8, textAlign: 'center', width: '100%' }}>Payment Successful!</Text>
                <Text style={{ fontSize: 16, color: colors.text, textAlign: 'center', marginBottom: 8, width: '100%' }}>Thank you for your payment.</Text>
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
            case 0: return renderMethodStep();
            case 1: return renderDetailsStep();
            case 2: return renderReviewStep();
            case 3: return renderSuccessStep();
            default: return renderMethodStep();
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
        paddingTop: 24,
        paddingBottom: 20,
    },
    stepContainer: {
        flex: 1,
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        width: '100%',
        marginTop: 32,
    },
    title: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 32,
        marginBottom: 24,
        textAlign: 'left',
        letterSpacing: -1,
    },
    input: {
        marginBottom: 24,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 16,
        marginVertical: 8,
        width: '100%',
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    backButton: {
        marginTop: 8,
        alignSelf: 'center',
        padding: 8,
    },
    backButtonText: {
        color: colors.primary,
        fontSize: 15,
        fontWeight: '500',
    },
    reviewCard: {
        backgroundColor: colors.inputBackground,
        borderRadius: 16,
        padding: 20,
        marginBottom: 24,
        width: '100%',
    },
    reviewLabel: {
        fontSize: 14,
        color: colors.text,
        opacity: 0.7,
        marginTop: 8,
    },
    reviewValue: {
        fontSize: 18,
        color: colors.text,
        fontWeight: '600',
    },
    successText: {
        fontSize: 18,
        color: colors.success || '#4BB543',
        marginVertical: 16,
        textAlign: 'center',
        width: '100%',
    },
});

export default PaymentGatewayScreen; 