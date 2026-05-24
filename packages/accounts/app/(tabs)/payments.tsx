import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity, ActivityIndicator, Linking, Image } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { Section } from '@/components/section';
import { useOxy } from '@oxyhq/services';
import { toast } from '@oxyhq/bloom';
import { formatDate } from '@/utils/date-utils';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import faircoinImage from '@/assets/images/faircoin.jpg';
import { useTranslation } from '@/lib/i18n';

export default function PaymentsScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 768;
  const { t } = useTranslation();

  // OxyServices integration — auth is enforced by the `(tabs)` layout.
  const { user, oxyServices, isLoading: oxyLoading, showBottomSheet } = useOxy();
  const [subscription, setSubscription] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedPaymentMethod, setExpandedPaymentMethod] = useState<string | null>(null);

  // Fetch all payment-related data in parallel
  const fetchAllPaymentData = useCallback(async () => {
    if (!oxyServices || !user?.id) {
      return;
    }

    const [subResult, paymentsResult, walletResult, txResult] = await Promise.allSettled([
      oxyServices.getCurrentUserSubscription(),
      oxyServices.getUserPayments(),
      oxyServices.getCurrentUserWallet(),
      oxyServices.getCurrentUserWalletTransactions({ limit: 5 }),
    ]);

    setSubscription(subResult.status === 'fulfilled' ? subResult.value : { plan: 'basic', status: 'active' });
    setPayments(paymentsResult.status === 'fulfilled' ? (paymentsResult.value || []) : []);
    setWallet(walletResult.status === 'fulfilled' ? walletResult.value : null);

    if (txResult.status === 'fulfilled') {
      const txValue = txResult.value;
      setTransactions(Array.isArray(txValue) ? txValue : (txValue?.data || []));
    } else {
      setTransactions([]);
    }
  }, [oxyServices, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!oxyServices || !user?.id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      await fetchAllPaymentData();
      if (!cancelled) setLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [oxyServices, user?.id, fetchAllPaymentData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchAllPaymentData();
    } finally {
      setRefreshing(false);
    }
  }, [fetchAllPaymentData]);

  // Format subscription plan name
  const getPlanName = useCallback((plan: string) => {
    const key = `payments.subscription.plans.${plan}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return plan.charAt(0).toUpperCase() + plan.slice(1);
  }, [t]);

  // Format subscription status
  const getSubscriptionStatus = useCallback((sub: any) => {
    if (!sub || sub.plan === 'basic') {
      return t('payments.subscription.noActive');
    }

    if (sub.status === 'canceled') {
      return t('payments.subscription.canceled');
    }

    if (sub.status === 'expired') {
      return t('payments.subscription.expired');
    }

    if (sub.endDate) {
      const endDate = new Date(sub.endDate);
      const now = new Date();
      if (endDate < now) {
        return t('payments.subscription.expired');
      }
      return t('payments.subscription.renews', { date: formatDate(sub.endDate) });
    }

    return t('payments.subscription.active');
  }, [t]);

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

  // Format payment status with color
  const getPaymentStatusColor = useCallback((status?: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'succeeded':
      case 'paid':
        return colors.success;
      case 'pending':
      case 'processing':
        return colors.warning;
      case 'failed':
      case 'declined':
        return colors.error;
      default:
        return colors.textSecondary;
    }
  }, [colors]);

  const getPaymentStatusLabel = useCallback((status?: string) => {
    if (!status) return t('payments.status.completed');
    const lower = status.toLowerCase();
    const key = `payments.status.${lower}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  }, [t]);

  // Format transaction type label
  const getTransactionTypeLabel = useCallback((type?: string) => {
    if (!type) return t('payments.tx.transaction');
    const lower = type.toLowerCase();
    const key = `payments.tx.${lower}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return type.charAt(0).toUpperCase() + type.slice(1);
  }, [t]);

  const togglePaymentMethodExpanded = useCallback((id: string) => {
    setExpandedPaymentMethod(prev => prev === id ? null : id);
  }, []);

  const handleInstallFairCoinWallet = useCallback(() => {
    const walletUrl = 'https://fairco.in/wallet';
    
    Linking.openURL(walletUrl).catch((err) => {
      console.error('Failed to open FAIRWallet URL:', err);
      toast.error(t('payments.fairCoinBanner.openMessage'));
    });
  }, [t]);

  // Subscription section items
  const subscriptionItems = useMemo(() => {
    const planName = subscription ? getPlanName(subscription.plan) : t('payments.subscription.plans.basic');
    const status = subscription ? getSubscriptionStatus(subscription) : t('payments.subscription.noActive');
    const nextBilling = subscription ? getNextBillingDate(subscription) : null;

    return [{
      id: 'subscription',
      icon: 'credit-card-outline',
      iconColor: subscription?.plan !== 'basic' && subscription?.status === 'active'
        ? colors.success
        : colors.sidebarIconPayments,
      title: planName,
      subtitle: subscription?.plan !== 'basic' && subscription?.status === 'active'
        ? nextBilling
          ? t('payments.subscription.nextBilling', { date: nextBilling })
          : status
        : t('payments.subscription.upgrade'),
      customContent: (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleManageSubscription}
          accessibilityRole="button"
          accessibilityLabel={subscription?.plan !== 'basic' ? t('a11y.manageSubscription') : t('a11y.upgradeSubscription')}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>
            {subscription?.plan !== 'basic' ? t('payments.subscription.manage') : t('payments.subscription.upgradeCta')}
          </Text>
        </TouchableOpacity>
      ),
    }];
  }, [subscription, colors, getPlanName, getSubscriptionStatus, getNextBillingDate, handleManageSubscription, t]);

  // Wallet section items
  const walletItems = useMemo(() => {
    const items: any[] = [];
    const walletBalance = wallet?.balance || 0;

    // Oxy Pay wallet
    items.push({
      id: 'oxy-pay',
      icon: 'wallet-outline',
      iconColor: colors.sidebarIconPayments,
      title: t('payments.wallet.oxyPay'),
      subtitle: t('payments.wallet.oxyPaySubtitle', { balance: formatFairCoinBalance(walletBalance) }),
    });

    // FairCoin/FAIRWallet info
    items.push({
      id: 'faircoin',
      icon: 'qrcode-scan',
      iconColor: '#FF6B35',
      title: t('payments.wallet.fairwallet'),
      subtitle: t('payments.wallet.fairwalletSubtitle'),
    });

    return items;
  }, [wallet, colors, formatFairCoinBalance, t]);

  // Payment methods section
  const paymentMethodsItems = useMemo(() => {
    const items: any[] = [];

    // Credit/Debit Card
    items.push({
      id: 'card',
      icon: 'credit-card-outline',
      iconColor: colors.sidebarIconPayments,
      title: t('payments.methods.card'),
      subtitle: subscription?.paymentMethod
        ? t('payments.methods.cardWithMethod', { method: subscription.paymentMethod })
        : t('payments.methods.cardEmpty'),
      onPress: () => togglePaymentMethodExpanded('card'),
      showChevron: true,
    });

    // Oxy Pay
    items.push({
      id: 'oxy-pay-method',
      icon: 'wallet-outline',
      iconColor: colors.sidebarIconPayments,
      title: t('payments.methods.oxyPay'),
      subtitle: t('payments.methods.oxyPaySubtitle', { balance: formatFairCoinBalance(wallet?.balance || 0) }),
      onPress: () => togglePaymentMethodExpanded('oxy-pay-method'),
      showChevron: true,
    });

    // FairCoin
    items.push({
      id: 'faircoin-method',
      icon: 'qrcode-scan',
      iconColor: '#FF6B35',
      title: t('payments.methods.fairwallet'),
      subtitle: t('payments.methods.fairwalletSubtitle'),
      onPress: () => togglePaymentMethodExpanded('faircoin-method'),
      showChevron: true,
    });

    return items;
  }, [subscription, wallet, colors, formatFairCoinBalance, togglePaymentMethodExpanded, t]);

  // Billing history items for inline display
  const billingHistoryItems = useMemo(() => {
    return payments.map((payment, index) => {
      const date = payment.createdAt ? formatDate(payment.createdAt) : t('payments.history.unknownDate');
      const amount = payment.amount ? `${payment.amount.toFixed(2)}` : 'N/A';
      const currency = payment.currency || 'FAIR';
      const status = payment.status || 'completed';

      return {
        id: `billing-${payment.id || index}`,
        icon: 'file-document-outline',
        iconColor: colors.sidebarIconData,
        title: `${amount} ${currency}`,
        subtitle: date,
        customContent: (
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: getPaymentStatusColor(status) }]} />
            <Text style={[styles.statusText, { color: getPaymentStatusColor(status) }]}>
              {getPaymentStatusLabel(status)}
            </Text>
          </View>
        ),
      };
    });
  }, [payments, colors, getPaymentStatusColor, getPaymentStatusLabel, t]);

  // Transaction history items for inline display
  const transactionHistoryItems = useMemo(() => {
    return transactions.map((tx, index) => {
      const date = tx.createdAt ? formatDate(tx.createdAt) : t('payments.history.unknownDate');
      const amount = tx.amount ? tx.amount.toFixed(2) : 'N/A';
      const type = tx.type || 'transaction';
      const isCredit = type.toLowerCase() === 'credit' || type.toLowerCase() === 'deposit' || type.toLowerCase() === 'refund';
      const txIcon = isCredit ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline';

      return {
        id: `tx-${tx.id || index}`,
        icon: txIcon,
        iconColor: isCredit ? colors.success : colors.sidebarIconPayments,
        title: getTransactionTypeLabel(type),
        subtitle: date,
        customContent: (
          <Text style={[
            styles.transactionAmount,
            { color: isCredit ? colors.success : colors.text },
          ]}>
            {isCredit ? '+' : '-'} {amount}
          </Text>
        ),
      };
    });
  }, [transactions, colors, getTransactionTypeLabel, t]);

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
        title: t('payments.info.fairCoin'),
        subtitle: t('payments.info.fairCoinBody'),
      },
      {
        id: 'oxy-pay',
        icon: 'wallet-outline',
        iconColor: colors.sidebarIconPersonalInfo,
        title: t('payments.info.oxyPay'),
        subtitle: t('payments.info.oxyPayBody'),
      },
      {
        id: 'fairwallet',
        icon: 'qrcode-scan',
        iconColor: colors.sidebarIconSharing,
        title: t('payments.info.fairwallet'),
        subtitle: t('payments.info.fairwalletBody'),
      },
      {
        id: 'security',
        icon: 'shield-check-outline',
        iconColor: colors.sidebarIconSecurity,
        title: t('payments.info.security'),
        subtitle: t('payments.info.securityBody'),
      },
      {
        id: 'payment-methods',
        icon: 'credit-card-outline',
        iconColor: colors.sidebarIconData,
        title: t('payments.info.paymentMethods'),
        subtitle: t('payments.info.paymentMethodsBody'),
      },
    ];
  }, [colors, t]);

  if (loading || oxyLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <ThemedText style={[styles.loadingText, { color: colors.text }]}>{t('payments.loading')}</ThemedText>
      </View>
    );
  }

  const storeButtonLabel = Platform.OS === 'ios'
    ? t('payments.fairCoinBanner.appStore')
    : Platform.OS === 'android'
      ? t('payments.fairCoinBanner.playStore')
      : t('payments.fairCoinBanner.download');

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
              <Text style={styles.faircoinBannerTitle}>{t('payments.fairCoinBanner.title')}</Text>
              <Text style={styles.faircoinBannerDescription}>
                {t('payments.fairCoinBanner.description')}
              </Text>
            </View>

            {/* Button */}
            <TouchableOpacity
              style={styles.faircoinBannerButton}
              onPress={handleInstallFairCoinWallet}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('a11y.openStore')}
              accessibilityHint={t('a11y.openStoreHint')}
            >
              <MaterialCommunityIcons
                name={Platform.OS === 'ios' ? 'apple' : Platform.OS === 'android' ? 'google-play' : 'download'}
                size={18}
                color="#1A1A1A"
              />
              <Text style={styles.faircoinBannerButtonText}>
                {storeButtonLabel}
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
            <Text style={[styles.walletSubtitle, { color: colors.textSecondary }]}>
              {t('payments.wallet.subtitle')}
            </Text>
          </View>

          {/* Summary Cards */}
          <View style={styles.walletSummaryCards}>
            <View style={[styles.summaryCard, { backgroundColor: colors.background }]}>
              <Text style={[styles.summaryCardValue, { color: colors.text }]}>
                {transactions.length}
              </Text>
              <Text style={[styles.summaryCardLabel, { color: colors.textSecondary }]}>
                {t('payments.wallet.transactions')}
              </Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: colors.background }]}>
              <Text style={[styles.summaryCardValue, { color: colors.text }]}>
                {payments.length}
              </Text>
              <Text style={[styles.summaryCardLabel, { color: colors.textSecondary }]}>
                {t('payments.wallet.payments')}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Subscription Section */}
      <Section title={t('payments.sections.subscription')}>
        <AccountCard>
          <GroupedSection items={subscriptionItems} />
        </AccountCard>
      </Section>

      {/* Wallet Section */}
      <Section title={t('payments.sections.wallets')}>
        <AccountCard>
          <GroupedSection items={walletItems} />
        </AccountCard>
      </Section>

      {/* Payment Methods Section */}
      <Section title={t('payments.sections.paymentMethods')}>
        <AccountCard>
          <GroupedSection items={paymentMethodsItems} />
        </AccountCard>
        {expandedPaymentMethod && (
          <View style={[styles.expandedDetails, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {expandedPaymentMethod === 'card' && (
              <>
                <Text style={[styles.expandedTitle, { color: colors.text }]}>{t('payments.methods.card')}</Text>
                <Text style={[styles.expandedBody, { color: colors.textSecondary }]}>
                  {t('payments.expanded.cardBody')}
                </Text>
              </>
            )}
            {expandedPaymentMethod === 'oxy-pay-method' && (
              <>
                <Text style={[styles.expandedTitle, { color: colors.text }]}>{t('payments.expanded.oxyPayTitle')}</Text>
                <Text style={[styles.expandedBody, { color: colors.textSecondary }]}>
                  {t('payments.expanded.oxyPayBody')}
                </Text>
              </>
            )}
            {expandedPaymentMethod === 'faircoin-method' && (
              <>
                <Text style={[styles.expandedTitle, { color: colors.text }]}>{t('payments.methods.fairwallet')}</Text>
                <Text style={[styles.expandedBody, { color: colors.textSecondary }]}>
                  {t('payments.expanded.fairwalletBody')}
                </Text>
              </>
            )}
          </View>
        )}
      </Section>

      {/* Billing History Section */}
      <Section title={t('payments.sections.billingHistory')}>
        {billingHistoryItems.length > 0 ? (
          <AccountCard>
            <GroupedSection items={billingHistoryItems} />
          </AccountCard>
        ) : (
          <AccountCard>
            <View style={styles.emptyStateContainer}>
              <MaterialCommunityIcons
                name="file-document-outline"
                size={40}
                color={colors.text}
                style={styles.emptyStateIcon}
              />
              <Text style={[styles.emptyStateTitle, { color: colors.text }]}>
                {t('payments.history.noBilling')}
              </Text>
              <Text style={[styles.emptyStateSubtitle, { color: colors.textSecondary }]}>
                {t('payments.history.noBillingSubtitle')}
              </Text>
            </View>
          </AccountCard>
        )}
      </Section>

      {/* Transaction History Section */}
      <Section title={t('payments.sections.transactionHistory')}>
        {transactionHistoryItems.length > 0 ? (
          <AccountCard>
            <GroupedSection items={transactionHistoryItems} />
          </AccountCard>
        ) : (
          <AccountCard>
            <View style={styles.emptyStateContainer}>
              <MaterialCommunityIcons
                name="swap-horizontal"
                size={40}
                color={colors.text}
                style={styles.emptyStateIcon}
              />
              <Text style={[styles.emptyStateTitle, { color: colors.text }]}>
                {t('payments.history.noTransactions')}
              </Text>
              <Text style={[styles.emptyStateSubtitle, { color: colors.textSecondary }]}>
                {t('payments.history.noTransactionsSubtitle')}
              </Text>
            </View>
          </AccountCard>
        )}
      </Section>

      {/* Info Section */}
      <Section title={t('payments.sections.about')}>
        <AccountCard>
          <GroupedSection items={infoItems} />
        </AccountCard>
      </Section>
    </>
  );

  if (isDesktop) {
    return (
      <>
        <ScreenHeader title={t('payments.title')} subtitle={t('payments.subtitle')} />
        {content}
      </>
    );
  }

  return (
    <ScreenContentWrapper refreshing={refreshing} onRefresh={handleRefresh}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title={t('payments.title')} subtitle={t('payments.subtitle')} />
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
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  transactionAmount: {
    fontSize: 15,
    fontWeight: '600',
  },
  expandedDetails: {
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
  },
  expandedTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  expandedBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  emptyStateIcon: {
    opacity: 0.4,
    marginBottom: 12,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
    opacity: 0.8,
  },
  emptyStateSubtitle: {
    fontSize: 13,
    opacity: 0.6,
    textAlign: 'center',
    lineHeight: 18,
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
