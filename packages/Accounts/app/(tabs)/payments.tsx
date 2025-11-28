import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard } from '@/components/ui';

export default function PaymentsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const paymentItems = useMemo(() => [
    {
      id: 'subscription',
      icon: 'credit-card-outline',
      iconColor: colors.sidebarIconPayments,
      title: 'Oxy Pro',
      subtitle: '$9.99/month • Next billing: Feb 21, 2025',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Manage</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'payment-method',
      icon: 'wallet-outline',
      iconColor: colors.sidebarIconPayments,
      title: 'Payment methods',
      subtitle: 'Visa •••• 1234',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Edit</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'billing',
      icon: 'file-document-outline',
      iconColor: colors.sidebarIconData,
      title: 'Billing history',
      subtitle: 'View past invoices and payments',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>View</Text>
        </TouchableOpacity>
      ),
    },
  ], [colors]);


  if (isDesktop) {
    return (
      <>
        <View style={styles.headerSection}>
          <ThemedText style={styles.title}>Payments & subscriptions</ThemedText>
          <ThemedText style={styles.subtitle}>Manage your payment methods and subscriptions.</ThemedText>
        </View>
        <AccountCard>
          <GroupedSection items={paymentItems} />
        </AccountCard>
      </>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.mobileContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.mobileHeaderSection}>
          <ThemedText style={styles.mobileTitle}>Payments & subscriptions</ThemedText>
          <ThemedText style={styles.mobileSubtitle}>Manage your payment methods and subscriptions.</ThemedText>
        </View>
        <AccountCard>
          <GroupedSection items={paymentItems} />
        </AccountCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  desktopBody: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopSidebar: {
    width: 260,
    padding: 20,
  },
  desktopHeader: {
    marginBottom: 24,
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 4,
  },
  welcomeSubtext: {
    fontSize: 13,
    opacity: 0.6,
  },
  menuContainer: {
    gap: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 26,
    gap: 12,
  },
  menuItemActive: {},
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '400',
  },
  desktopMain: {
    flex: 1,
    maxWidth: 720,
  },
  desktopMainContent: {
    padding: 32,
  },
  headerSection: {
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.6,
  },
  accountCard: {
    borderRadius: 16,
    overflow: 'hidden',
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
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
  mobileHeaderSection: {
    marginBottom: 20,
  },
  mobileTitle: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 6,
  },
  mobileSubtitle: {
    fontSize: 15,
    opacity: 0.6,
  },
});

