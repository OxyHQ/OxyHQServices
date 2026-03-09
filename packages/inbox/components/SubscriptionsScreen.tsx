/**
 * Subscriptions management screen.
 *
 * Lists newsletter/mailing-list senders with unsubscribe actions,
 * similar to Gmail's "Manage subscriptions" feature.
 */

import React, { useMemo, useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Menu01Icon,
  ArrowLeft01Icon,
  Mail01Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from 'expo-router';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useSubscriptions } from '@/hooks/queries/useSubscriptions';
import { useUnsubscribe } from '@/hooks/mutations/useUnsubscribe';
import { SubscriptionRow } from '@/components/SubscriptionRow';
import type { Subscription } from '@/services/emailApi';

export function SubscriptionsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 900;

  const {
    data,
    isLoading,
    isRefetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSubscriptions();

  const unsubscribeMutation = useUnsubscribe();
  const [unsubscribingAddress, setUnsubscribingAddress] = useState<string | null>(null);

  const subscriptions = useMemo(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data],
  );

  const handleOpenDrawer = useCallback(
    () => navigation.dispatch(DrawerActions.openDrawer()),
    [navigation],
  );

  const handleBack = useCallback(() => router.back(), [router]);

  const handleUnsubscribe = useCallback(
    (senderAddress: string, method?: 'list-unsubscribe' | 'block') => {
      setUnsubscribingAddress(senderAddress);
      unsubscribeMutation.mutate(
        { senderAddress, method },
        { onSettled: () => setUnsubscribingAddress(null) },
      );
    },
    [unsubscribeMutation],
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: { item: Subscription }) => (
      <SubscriptionRow
        subscription={item}
        onUnsubscribe={handleUnsubscribe}
        isUnsubscribing={unsubscribingAddress === item._id}
      />
    ),
    [handleUnsubscribe, unsubscribingAddress],
  );

  const renderSeparator = useCallback(
    () => (
      <View
        style={[styles.separator, { backgroundColor: colors.border }]}
      />
    ),
    [colors.border],
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        {Platform.OS === 'web' ? (
          <HugeiconsIcon
            icon={Mail01Icon as unknown as IconSvgElement}
            size={64}
            color={colors.border}
          />
        ) : (
          <MaterialCommunityIcons
            name="email-check-outline"
            size={64}
            color={colors.border}
          />
        )}
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No subscriptions found
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
          Senders who email you frequently will appear here.
        </Text>
      </View>
    ),
    [colors],
  );

  const renderFooter = useCallback(
    () =>
      isFetchingNextPage ? (
        <View style={styles.footer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : null,
    [isFetchingNextPage, colors.primary],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border },
          !isDesktop && { paddingTop: insets.top },
        ]}
      >
        {!isDesktop && (
          <TouchableOpacity
            onPress={handleBack}
            style={styles.iconButton}
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon
                icon={ArrowLeft01Icon as unknown as IconSvgElement}
                size={24}
                color={colors.icon}
              />
            ) : (
              <MaterialCommunityIcons
                name="arrow-left"
                size={24}
                color={colors.icon}
              />
            )}
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Subscriptions
        </Text>
      </View>

      {/* Subtitle */}
      <View style={[styles.subtitle, { borderBottomColor: colors.border }]}>
        <Text style={[styles.subtitleText, { color: colors.secondaryText }]}>
          When you unsubscribe, it can take a few days to stop receiving messages
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlashList
          data={subscriptions}
          renderItem={renderItem}
          ItemSeparatorComponent={renderSeparator}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && !isFetchingNextPage}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={
            subscriptions.length === 0
              ? styles.emptyListContent
              : undefined
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  subtitle: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subtitleText: {
    fontSize: 13,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 16,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyListContent: {
    flexGrow: 1,
  },
  footer: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
