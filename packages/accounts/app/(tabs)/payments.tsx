import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity, ActivityIndicator, ScrollView, Linking, Image } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader, useAlert } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { Section } from '@/components/section';
import { useOxy } from '@oxyhq/services';
import { formatDate } from '@/utils/date-utils';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import faircoinImage from '@/assets/images/faircoin.jpg';

export default function PaymentsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const router = useRouter();
  const alert = useAlert();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  // OxyServices integration
  const { user, oxyServices, isAuthenticated, isLoading: oxyLoading, showBottomSheet } = useOxy();
  const [subscription, setSubscription] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch all payment-related data
  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated || !oxyServices || !user?.id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        
        // Fetch subscription
        try {
          const sub = await oxyServices.getCurrentUserSubscription();
          setSubscription(sub);
        } catch (error) {
          console.error('Failed to fetch subscription:', error);
          setSubscription({ plan: 'basic', status: 'active' });
        }

        // Fetch payments
        try {
          const userPayments = await oxyServices.getUserPayments();
          setPayments(userPayments || []);
        } catch (error) {
          console.error('Failed to fetch payments:', error);
          setPayments([]);
        }

        // Fetch wallet
        try {
          const userWallet = await oxyServices.getCurrentUserWallet();
          setWallet(userWallet);
        } catch (error) {
          console.error('Failed to fetch wallet:', error);
          setWallet(null);
        }

        // Fetch recent transactions
        try {
          const walletTransactions = await oxyServices.getCurrentUserWalletTransactions({ limit: 5 });
          setTransactions(Array.isArray(walletTransactions) ? walletTransactions : walletTransactions?.data || []);
        } catch (error) {
          console.error('Failed to fetch transactions:', error);
          setTransactions([]);
        }
      } catch (error) {
        console.error('Failed to fetch payment data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated, oxyServices, user?.id]);

  // Format subscription plan name
  const getPlanName = useCallback((plan: string) => {
    const planNames: Record<string, string> = {
      basic: 'Basic',
      pro: 'Oxy Pro',
      business: 'Oxy Business',
    };
    return planNames[plan] || plan.charAt(0).toUpperCase() + plan.slice(1);
  }, []);

  // Format subscription status
  const getSubscriptionStatus = useCallback((sub: any) => {
    if (!sub || sub.plan === 'basic') {
      return 'No active subscription';
    }
    
    if (sub.status === 'canceled') {
      return 'Canceled';
    }
    
    if (sub.status === 'expired') {
      return 'Expired';
    }

    if (sub.endDate) {
      const endDate = new Date(sub.endDate);
      const now = new Date();
      if (endDate < now) {
        return 'Expired';
      }
      return `Renews ${formatDate(sub.endDate)}`;
    }

    return 'Active';
  }, []);

  // Format next billing date
  const getNextBillingDate = useCallback((sub: any) => {
    if (!sub || sub.plan === 'basic' || sub.status !== 'active') {
      return null;
    }
    
    if (sub.endDate) {
      return formatDate(sub.endDate);
    }
    
    return null;
  }, []);

  // Format FairCoin balance
  const formatFairCoinBalance = useCallback((balance: number) => {
    return `⊜ ${balance.toFixed(2)}`;
  }, []);

  const handleManageSubscription = useCallback(() => {
    showBottomSheet?.('PremiumSubscription');
  }, [showBottomSheet]);

  const handleViewPaymentMethods = useCallback(() => {
    // Show information about available payment methods
    alert(
      'Payment Methods',
      'Available payment methods:\n\n• Credit/Debit Card - Secure card payments\n• Oxy Pay - Use your in-app wallet balance\n• FAIRWallet - Pay with FairCoin via QR code\n\nTo make a payment, use the payment gateway when purchasing subscriptions or services.',
      [{ text: 'OK' }]
    );
  }, [alert]);

  const handleViewBillingHistory = useCallback(() => {
    if (payments.length === 0) {
      alert(
        'Billing History',
        'No payment history found.',
        [{ text: 'OK' }]
      );
      return;
    }
    
    const historyText = payments.map((payment, index) => {
      const date = payment.createdAt ? formatDate(payment.createdAt) : 'Unknown date';
      const amount = payment.amount ? `⊜ ${payment.amount.toFixed(2)}` : 'N/A';
      const currency = payment.currency || 'FAIR';
      return `${index + 1}. ${date} - ${amount} ${currency}`;
    }).join('\n');

    alert(
      'Billing History',
      historyText || 'No payment history available.',
      [{ text: 'OK' }]
    );
  }, [payments, alert]);

  const handleViewWalletDetails = useCallback(() => {
    const balance = wallet?.balance || 0;
    alert(
      'Oxy Pay Wallet',
      `Your current balance: ${formatFairCoinBalance(balance)}\n\nOxy Pay is your in-app wallet that uses FairCoin (⊜) as the base currency. You can use your balance to pay for subscriptions, services, and other Oxy features.`,
      [{ text: 'OK' }]
    );
  }, [wallet, formatFairCoinBalance, alert]);

  const handleViewTransactions = useCallback(() => {
    if (transactions.length === 0) {
      alert(
        'Transaction History',
        'No transactions found.',
        [{ text: 'OK' }]
      );
      return;
    }
    
    const historyText = transactions.map((tx, index) => {
      const date = tx.createdAt ? formatDate(tx.createdAt) : 'Unknown date';
      const amount = tx.amount ? `⊜ ${tx.amount.toFixed(2)}` : 'N/A';
      const type = tx.type || 'transaction';
      return `${index + 1}. ${date} - ${type} - ${amount}`;
    }).join('\n');

    alert(
      'Transaction History',
      historyText || 'No transaction history available.',
      [{ text: 'OK' }]
    );
  }, [transactions, alert]);

  const handleInstallFairCoinWallet = useCallback(() => {
    const walletUrl = 'https://fairco.in/wallet';
    
    Linking.openURL(walletUrl).catch((err) => {
      console.error('Failed to open FAIRWallet URL:', err);
      alert(
        'Open FAIRWallet',
        'Please visit https://fairco.in/wallet to learn more about FAIRWallet.',
        [{ text: 'OK' }]
      );
    });
  }, [alert]);

  // Subscription section items
  const subscriptionItems = useMemo(() => {
    const planName = subscription ? getPlanName(subscription.plan) : 'Basic';
    const status = subscription ? getSubscriptionStatus(subscription) : 'No active subscription';
    const nextBilling = subscription ? getNextBillingDate(subscription) : null;
    
    return [{
      id: 'subscription',
      icon: 'credit-card-outline',
      iconColor: subscription?.plan !== 'basic' && subscription?.status === 'active' 
        ? '#34C759' 
        : colors.sidebarIconPayments,
      title: planName,
      subtitle: subscription?.plan !== 'basic' && subscription?.status === 'active'
        ? nextBilling 
          ? `Next billing: ${nextBilling}`
          : status
        : 'Upgrade to unlock premium features',
      customContent: (
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleManageSubscription}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>
            {subscription?.plan !== 'basic' ? 'Manage' : 'Upgrade'}
          </Text>
        </TouchableOpacity>
      ),
    }];
  }, [subscription, colors, getPlanName, getSubscriptionStatus, getNextBillingDate, handleManageSubscription]);

  // Wallet section items
  const walletItems = useMemo(() => {
    const items: any[] = [];
    const walletBalance = wallet?.balance || 0;

    // Oxy Pay wallet
    items.push({
      id: 'oxy-pay',
      icon: 'wallet-outline',
      iconColor: colors.sidebarIconPayments,
      title: 'Oxy Pay',
      subtitle: `Balance: ${formatFairCoinBalance(walletBalance)}`,
      customContent: (
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleViewWalletDetails}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>Details</Text>
        </TouchableOpacity>
      ),
    });

    // FairCoin/FAIRWallet info
    items.push({
      id: 'faircoin',
      icon: 'qrcode-scan',
      iconColor: '#FF6B35',
      title: 'FAIRWallet',
      subtitle: 'FairCoin cryptocurrency payments',
      customContent: (
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleViewPaymentMethods}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>Info</Text>
        </TouchableOpacity>
      ),
    });

    return items;
  }, [wallet, colors, formatFairCoinBalance, handleViewWalletDetails, handleViewPaymentMethods]);

  // Payment methods section
  const paymentMethodsItems = useMemo(() => {
    const items: any[] = [];

    // Credit/Debit Card
    items.push({
      id: 'card',
      icon: 'credit-card-outline',
      iconColor: colors.sidebarIconPayments,
      title: 'Credit/Debit Card',
      subtitle: subscription?.paymentMethod 
        ? `${subscription.paymentMethod} ••••`
        : 'No card on file',
      customContent: (
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleViewPaymentMethods}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>Info</Text>
        </TouchableOpacity>
      ),
    });

    // Oxy Pay
    items.push({
      id: 'oxy-pay-method',
      icon: 'wallet-outline',
      iconColor: colors.sidebarIconPayments,
      title: 'Oxy Pay',
      subtitle: `Balance: ${formatFairCoinBalance(wallet?.balance || 0)}`,
      customContent: (
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleViewWalletDetails}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>Details</Text>
        </TouchableOpacity>
      ),
    });

    // FairCoin
    items.push({
      id: 'faircoin-method',
      icon: 'qrcode-scan',
      iconColor: '#FF6B35',
      title: 'FAIRWallet',
      subtitle: 'FairCoin cryptocurrency',
      customContent: (
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleViewPaymentMethods}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>Info</Text>
        </TouchableOpacity>
      ),
    });

    return items;
  }, [subscription, wallet, colors, formatFairCoinBalance, handleViewPaymentMethods, handleViewWalletDetails]);

  // History section items
  const historyItems = useMemo(() => {
    const items: any[] = [];

    // Billing history
    items.push({
      id: 'billing',
      icon: 'file-document-outline',
      iconColor: colors.sidebarIconData,
      title: 'Billing history',
      subtitle: payments.length > 0 
        ? `${payments.length} payment${payments.length !== 1 ? 's' : ''}`
        : 'No payment history',
      customContent: (
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleViewBillingHistory}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>View</Text>
        </TouchableOpacity>
      ),
    });

    // Transaction history
    if (transactions.length > 0) {
      items.push({
        id: 'transactions',
        icon: 'swap-horizontal',
        iconColor: colors.sidebarIconPayments,
        title: 'Transaction history',
        subtitle: `${transactions.length} recent transaction${transactions.length !== 1 ? 's' : ''}`,
        customContent: (
          <TouchableOpacity 
            style={[styles.button, { backgroundColor: colors.card }]}
            onPress={handleViewTransactions}
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>View</Text>
          </TouchableOpacity>
        ),
      });
    }

    return items;
  }, [payments, transactions, colors, handleViewBillingHistory, handleViewTransactions]);

  // Info section items
  const infoItems = useMemo(() => {
    return [
      {
        id: 'faircoin',
        customIcon: (
          <View style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.sidebarIconPayments }}>
            <Image 
              source={faircoinImage} 
              style={{ width: 36, height: 36 }}
              resizeMode="cover"
            />
          </View>
        ),
        title: 'FairCoin (⊜)',
        subtitle: 'FairCoin is the base cryptocurrency used across all Oxy services. All transactions, including subscriptions, services, and in-app purchases, are denominated in FairCoin.',
      },
      {
        id: 'oxy-pay',
        icon: 'wallet-outline',
        iconColor: colors.sidebarIconPersonalInfo,
        title: 'Oxy Pay',
        subtitle: 'Oxy Pay is your in-app wallet that stores your FairCoin balance. Use it to pay for subscriptions, premium features, and services within the Oxy ecosystem. Your balance is displayed at the top of this screen.',
      },
      {
        id: 'fairwallet',
        icon: 'qrcode-scan',
        iconColor: colors.sidebarIconSharing,
        title: 'FAIRWallet',
        subtitle: 'FAIRWallet enables direct FairCoin payments via QR code scanning. When making a payment, you can choose FAIRWallet as your payment method and scan the generated QR code with your FairCoin wallet app.',
      },
      {
        id: 'security',
        icon: 'shield-check-outline',
        iconColor: colors.sidebarIconSecurity,
        title: 'Security & Privacy',
        subtitle: 'All payments are processed securely through Oxy services. Your payment information is encrypted and never stored on your device. Credit card details are handled by secure payment processors, and cryptocurrency transactions use blockchain technology for transparency and security.',
      },
      {
        id: 'payment-methods',
        icon: 'credit-card-outline',
        iconColor: colors.sidebarIconData,
        title: 'Payment Methods',
        subtitle: 'You can pay using Credit/Debit Cards, Oxy Pay wallet balance, or FAIRWallet. When purchasing subscriptions or services, the payment gateway will guide you through the process and allow you to choose your preferred payment method.',
      },
    ];
  }, [colors]);

  if (loading || oxyLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading...</ThemedText>
      </View>
    );
  }

  const content = (
    <>
      {/* FairCoin Wallet Banner */}
      <View style={[styles.faircoinBanner, { backgroundColor: '#1b1e09' }]}>
        <View style={styles.faircoinBannerContent}>
          {/* Left side - phone image */}
          <Image 
            source={faircoinImage} 
            style={styles.faircoinBannerImage}
            resizeMode="contain"
          />
          
          {/* Right side - text and button container */}
          <View style={styles.faircoinBannerRightContainer}>
            {/* Title and description */}
            <View style={styles.faircoinBannerTextContainer}>
              <Text style={styles.faircoinBannerTitle}>FairCoin Wallet</Text>
              <Text style={styles.faircoinBannerDescription}>
                A self-custody cryptocurrency wallet for managing your FairCoin. You control your keys and funds independently from Oxy services.
              </Text>
            </View>
            
            {/* Button */}
            <TouchableOpacity
              style={styles.faircoinBannerButton}
              onPress={handleInstallFairCoinWallet}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons 
                name={Platform.OS === 'ios' ? 'apple' : Platform.OS === 'android' ? 'google-play' : 'download'} 
                size={18} 
                color="#1A1A1A" 
              />
              <Text style={styles.faircoinBannerButtonText}>
                {Platform.OS === 'ios' ? 'App Store' : Platform.OS === 'android' ? 'Play Store' : 'Download'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Wallet Balance Card */}
      {wallet && (
        <View style={[styles.walletCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Large Icon */}
          <View style={styles.walletIconWrapper}>
            <View style={[styles.walletIconContainer, { backgroundColor: colors.sidebarIconPayments }]}>
              <MaterialCommunityIcons name="wallet-outline" size={48} color={darkenColor(colors.sidebarIconPayments)} />
            </View>
          </View>
          
          {/* Balance Display */}
          <View style={styles.walletBalanceWrapper}>
            <Text style={[styles.walletBalance, { color: colors.text }]}>
              {formatFairCoinBalance(wallet.balance || 0)}
            </Text>
            <Text style={[styles.walletSubtitle, { color: colors.secondaryText }]}>
              Your in-app wallet for Oxy services
            </Text>
          </View>

          {/* Summary Cards */}
          <View style={styles.walletSummaryCards}>
            <View style={[styles.summaryCard, { backgroundColor: colors.background }]}>
              <Text style={[styles.summaryCardValue, { color: colors.text }]}>
                {transactions.length}
              </Text>
              <Text style={[styles.summaryCardLabel, { color: colors.secondaryText }]}>
                Transactions
              </Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: colors.background }]}>
              <Text style={[styles.summaryCardValue, { color: colors.text }]}>
                {payments.length}
              </Text>
              <Text style={[styles.summaryCardLabel, { color: colors.secondaryText }]}>
                Payments
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Subscription Section */}
      <Section title="Subscription">
        <AccountCard>
          <GroupedSection items={subscriptionItems} />
        </AccountCard>
      </Section>

      {/* Wallet Section */}
      <Section title="Wallets">
        <AccountCard>
          <GroupedSection items={walletItems} />
        </AccountCard>
      </Section>

      {/* Payment Methods Section */}
      <Section title="Payment Methods">
        <AccountCard>
          <GroupedSection items={paymentMethodsItems} />
        </AccountCard>
      </Section>

      {/* History Section */}
      {historyItems.length > 0 && (
        <Section title="History">
          <AccountCard>
            <GroupedSection items={historyItems} />
          </AccountCard>
        </Section>
      )}

      {/* Info Section */}
      <Section title="About Payments">
        <AccountCard>
          <GroupedSection items={infoItems} />
        </AccountCard>
      </Section>
    </>
  );

  if (isDesktop) {
    return (
      <>
        <ScreenHeader title="Payments & subscriptions" subtitle="Manage your payment methods, subscriptions, and wallets." />
        {content}
      </>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title="Payments & subscriptions" subtitle="Manage your payment methods, subscriptions, and wallets." />
          {content}
        </View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    opacity: 0.7,
  },
  walletCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    marginBottom: 24,
  },
  walletIconWrapper: {
    alignItems: 'center',
    marginBottom: 16,
  },
  walletIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletBalanceWrapper: {
    alignItems: 'center',
    marginBottom: 24,
  },
  walletBalance: {
    fontSize: 40,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
    fontFamily: Platform.OS === 'web' ? 'Inter' : 'Inter-Bold',
    marginBottom: 8,
  },
  walletSubtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  walletSummaryCards: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  summaryCardValue: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  summaryCardLabel: {
    fontSize: 13,
    opacity: 0.8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  faircoinBanner: {
    borderRadius: 24,
    marginBottom: 24,
    overflow: 'hidden',
  },
  faircoinBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    minHeight: 70,
    flexWrap: 'wrap',
  },
  faircoinBannerImage: {
    width: 90,
    height: 70,
    marginRight: 10,
    flexShrink: 0,
  },
  faircoinBannerRightContainer: {
    flex: 1,
    minWidth: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  faircoinBannerTextContainer: {
    flex: 1,
    minWidth: 200,
    justifyContent: 'center',
  },
  faircoinBannerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#9ffb50',
    marginBottom: 3,
  },
  faircoinBannerDescription: {
    fontSize: 15,
    color: '#FFFFFF',
    opacity: 0.9,
    lineHeight: 20,
  },
  faircoinBannerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#9ffb50',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
    flexShrink: 0,
  },
  faircoinBannerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
  },
});
