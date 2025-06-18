import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Alert,
    Platform,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { Ionicons } from '@expo/vector-icons';

interface PaymentMethod {
    id: string;
    type: 'card' | 'paypal' | 'bank';
    last4?: string;
    brand?: string;
    expiryMonth?: number;
    expiryYear?: number;
    isDefault: boolean;
}

interface Invoice {
    id: string;
    date: string;
    amount: number;
    currency: string;
    status: 'paid' | 'pending' | 'failed';
    description: string;
    downloadUrl?: string;
}

const BillingManagementScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
    goBack,
}) => {
    const { user } = useOxy();
    const [loading, setLoading] = useState(true);
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [processingPayment, setProcessingPayment] = useState(false);

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#F5F5F5';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';
    const primaryColor = '#007AFF';
    const successColor = '#30D158';
    const warningColor = '#FF9500';
    const dangerColor = '#FF3B30';

    // Mock data
    const mockPaymentMethods: PaymentMethod[] = [
        {
            id: 'pm_1',
            type: 'card',
            last4: '4242',
            brand: 'Visa',
            expiryMonth: 12,
            expiryYear: 2027,
            isDefault: true
        },
        {
            id: 'pm_2',
            type: 'paypal',
            isDefault: false
        }
    ];

    const mockInvoices: Invoice[] = [
        {
            id: 'inv_1',
            date: '2024-12-01',
            amount: 19.99,
            currency: 'USD',
            status: 'paid',
            description: 'Pro Plan - Monthly'
        },
        {
            id: 'inv_2',
            date: '2024-11-01',
            amount: 19.99,
            currency: 'USD',
            status: 'paid',
            description: 'Pro Plan - Monthly'
        },
        {
            id: 'inv_3',
            date: '2024-10-01',
            amount: 19.99,
            currency: 'USD',
            status: 'paid',
            description: 'Pro Plan - Monthly'
        }
    ];

    useEffect(() => {
        loadBillingData();
    }, []);

    const loadBillingData = async () => {
        try {
            setLoading(true);
            
            // Simulate API calls
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            setPaymentMethods(mockPaymentMethods);
            setInvoices(mockInvoices);
        } catch (error) {
            console.error('Failed to load billing data:', error);
            toast.error('Failed to load billing information');
        } finally {
            setLoading(false);
        }
    };

    const handleAddPaymentMethod = () => {
        Alert.alert(
            'Add Payment Method',
            'This would open a secure payment form to add a new payment method.',
            [{ text: 'OK' }]
        );
    };

    const handleSetDefaultPaymentMethod = async (methodId: string) => {
        try {
            setPaymentMethods(prev => prev.map(method => ({
                ...method,
                isDefault: method.id === methodId
            })));
            toast.success('Default payment method updated');
        } catch (error) {
            toast.error('Failed to update payment method');
        }
    };

    const handleRemovePaymentMethod = (methodId: string) => {
        Alert.alert(
            'Remove Payment Method',
            'Are you sure you want to remove this payment method?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setPaymentMethods(prev => prev.filter(method => method.id !== methodId));
                            toast.success('Payment method removed');
                        } catch (error) {
                            toast.error('Failed to remove payment method');
                        }
                    }
                }
            ]
        );
    };

    const handleDownloadInvoice = (invoice: Invoice) => {
        toast.info('Invoice download would start here');
    };

    const getPaymentMethodIcon = (method: PaymentMethod) => {
        switch (method.type) {
            case 'card':
                return method.brand?.toLowerCase() === 'visa' ? 'card' : 'card-outline';
            case 'paypal':
                return 'logo-paypal';
            case 'bank':
                return 'business';
            default:
                return 'card';
        }
    };

    const getPaymentMethodDisplay = (method: PaymentMethod) => {
        switch (method.type) {
            case 'card':
                return `${method.brand} •••• ${method.last4}`;
            case 'paypal':
                return 'PayPal';
            case 'bank':
                return 'Bank Transfer';
            default:
                return 'Unknown';
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'paid':
                return successColor;
            case 'pending':
                return warningColor;
            case 'failed':
                return dangerColor;
            default:
                return textColor;
        }
    };

    if (loading) {
        return (
            <View style={[styles.container, { backgroundColor, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={primaryColor} />
                <Text style={[styles.loadingText, { color: textColor }]}>Loading billing information...</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: borderColor }]}>
                <TouchableOpacity style={styles.backButton} onPress={goBack}>
                    <Ionicons name="arrow-back" size={24} color={textColor} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: textColor }]}>Billing Management</Text>
                {onClose && (
                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                        <Ionicons name="close" size={24} color={textColor} />
                    </TouchableOpacity>
                )}
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Payment Methods */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={[styles.sectionTitle, { color: textColor }]}>Payment Methods</Text>
                        <TouchableOpacity
                            style={[styles.addButton, { backgroundColor: primaryColor }]}
                            onPress={handleAddPaymentMethod}
                        >
                            <Ionicons name="add" size={20} color="#FFFFFF" />
                            <Text style={styles.addButtonText}>Add</Text>
                        </TouchableOpacity>
                    </View>

                    {paymentMethods.map((method) => (
                        <View
                            key={method.id}
                            style={[styles.paymentMethodCard, { backgroundColor: secondaryBackgroundColor, borderColor }]}
                        >
                            <View style={styles.paymentMethodHeader}>
                                <View style={styles.paymentMethodInfo}>
                                    <Ionicons
                                        name={getPaymentMethodIcon(method)}
                                        size={24}
                                        color={primaryColor}
                                        style={styles.paymentMethodIcon}
                                    />
                                    <View>
                                        <Text style={[styles.paymentMethodName, { color: textColor }]}>
                                            {getPaymentMethodDisplay(method)}
                                        </Text>
                                        {method.type === 'card' && (
                                            <Text style={[styles.paymentMethodExpiry, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                                Expires {method.expiryMonth}/{method.expiryYear}
                                            </Text>
                                        )}
                                        {method.isDefault && (
                                            <View style={[styles.defaultBadge, { backgroundColor: successColor }]}>
                                                <Text style={styles.defaultText}>Default</Text>
                                            </View>
                                        )}
                                    </View>
                                </View>

                                <View style={styles.paymentMethodActions}>
                                    {!method.isDefault && (
                                        <TouchableOpacity
                                            style={[styles.actionButton, { borderColor }]}
                                            onPress={() => handleSetDefaultPaymentMethod(method.id)}
                                        >
                                            <Text style={[styles.actionButtonText, { color: textColor }]}>
                                                Set Default
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                    <TouchableOpacity
                                        style={[styles.actionButton, { borderColor: dangerColor }]}
                                        onPress={() => handleRemovePaymentMethod(method.id)}
                                    >
                                        <Text style={[styles.actionButtonText, { color: dangerColor }]}>
                                            Remove
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    ))}
                </View>

                {/* Billing History */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: textColor }]}>Billing History</Text>

                    {invoices.map((invoice) => (
                        <View
                            key={invoice.id}
                            style={[styles.invoiceCard, { backgroundColor: secondaryBackgroundColor, borderColor }]}
                        >
                            <View style={styles.invoiceHeader}>
                                <View style={styles.invoiceInfo}>
                                    <Text style={[styles.invoiceDescription, { color: textColor }]}>
                                        {invoice.description}
                                    </Text>
                                    <Text style={[styles.invoiceDate, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        {new Date(invoice.date).toLocaleDateString()}
                                    </Text>
                                </View>

                                <View style={styles.invoiceAmount}>
                                    <Text style={[styles.invoicePrice, { color: textColor }]}>
                                        ${invoice.amount.toFixed(2)}
                                    </Text>
                                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(invoice.status) }]}>
                                        <Text style={styles.statusText}>
                                            {invoice.status.toUpperCase()}
                                        </Text>
                                    </View>
                                </View>
                            </View>

                            <View style={styles.invoiceActions}>
                                <TouchableOpacity
                                    style={[styles.downloadButton, { borderColor }]}
                                    onPress={() => handleDownloadInvoice(invoice)}
                                >
                                    <Ionicons name="download" size={16} color={primaryColor} />
                                    <Text style={[styles.downloadButtonText, { color: primaryColor }]}>
                                        Download
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))}
                </View>

                {/* Billing Information */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: textColor }]}>Billing Information</Text>

                    <View style={[styles.billingInfoCard, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                        <View style={styles.billingInfoItem}>
                            <Ionicons name="business" size={20} color={primaryColor} />
                            <View style={styles.billingInfoContent}>
                                <Text style={[styles.billingInfoLabel, { color: textColor }]}>Billing Address</Text>
                                <Text style={[styles.billingInfoValue, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Update your billing address
                                </Text>
                            </View>
                            <TouchableOpacity>
                                <Ionicons name="chevron-forward" size={20} color={isDarkTheme ? '#666666' : '#999999'} />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.billingInfoItem}>
                            <Ionicons name="receipt" size={20} color={primaryColor} />
                            <View style={styles.billingInfoContent}>
                                <Text style={[styles.billingInfoLabel, { color: textColor }]}>Tax Information</Text>
                                <Text style={[styles.billingInfoValue, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Manage tax settings
                                </Text>
                            </View>
                            <TouchableOpacity>
                                <Ionicons name="chevron-forward" size={20} color={isDarkTheme ? '#666666' : '#999999'} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                <View style={styles.bottomSpacing} />
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    closeButton: {
        padding: 8,
    },
    content: {
        flex: 1,
    },
    section: {
        padding: 20,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        fontFamily: fontFamilies.phuduBold,
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
    },
    addButtonText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 4,
    },
    loadingText: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 16,
    },
    paymentMethodCard: {
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
    },
    paymentMethodHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    paymentMethodInfo: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
    },
    paymentMethodIcon: {
        marginRight: 12,
        marginTop: 2,
    },
    paymentMethodName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    paymentMethodExpiry: {
        fontSize: 14,
        marginBottom: 8,
    },
    defaultBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        alignSelf: 'flex-start',
    },
    defaultText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '600',
    },
    paymentMethodActions: {
        flexDirection: 'row',
        gap: 8,
    },
    actionButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
    },
    actionButtonText: {
        fontSize: 12,
        fontWeight: '600',
    },
    invoiceCard: {
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
    },
    invoiceHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    invoiceInfo: {
        flex: 1,
    },
    invoiceDescription: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    invoiceDate: {
        fontSize: 14,
    },
    invoiceAmount: {
        alignItems: 'flex-end',
    },
    invoicePrice: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    statusText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '600',
    },
    invoiceActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    downloadButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
    },
    downloadButtonText: {
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 4,
    },
    billingInfoCard: {
        borderRadius: 12,
        borderWidth: 1,
        overflow: 'hidden',
    },
    billingInfoItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0, 0, 0, 0.05)',
    },
    billingInfoContent: {
        flex: 1,
        marginLeft: 12,
    },
    billingInfoLabel: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    billingInfoValue: {
        fontSize: 14,
    },
    bottomSpacing: {
        height: 40,
    },
});

export default BillingManagementScreen;
