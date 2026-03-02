/**
 * A single row in the subscriptions list.
 * Shows sender avatar, name, email, message count, and an unsubscribe/block button.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { Avatar } from '@/components/Avatar';
import type { Subscription } from '@/services/emailApi';

function formatFrequency(count: number): string {
  if (count >= 20) return '20+ emails recently';
  if (count >= 10) return '10-20 emails recently';
  return `${count} emails recently`;
}

export function SubscriptionRow({
  subscription,
  onUnsubscribe,
  isUnsubscribing,
}: {
  subscription: Subscription;
  onUnsubscribe: (senderAddress: string, method?: 'list-unsubscribe' | 'block') => void;
  isUnsubscribing: boolean;
}) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

  const isBlockOnly = subscription.type === 'frequent';
  const buttonLabel = isBlockOnly ? 'Block' : 'Unsubscribe';
  const buttonColor = isBlockOnly ? colors.danger : colors.primary;

  const handlePress = () => {
    onUnsubscribe(
      subscription._id,
      isBlockOnly ? 'block' : 'list-unsubscribe',
    );
  };

  return (
    <View style={[styles.row, { backgroundColor: colors.background }]}>
      <Avatar name={subscription.name} size={40} />
      <View style={styles.content}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {subscription.name}
        </Text>
        <Text
          style={[styles.email, { color: colors.secondaryText }]}
          numberOfLines={1}
        >
          {subscription._id}
        </Text>
        <Text
          style={[styles.frequency, { color: colors.secondaryText }]}
          numberOfLines={1}
        >
          {formatFrequency(subscription.messageCount)}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.button, { borderColor: buttonColor }]}
        onPress={handlePress}
        disabled={isUnsubscribing}
        activeOpacity={0.7}
      >
        {isUnsubscribing ? (
          <ActivityIndicator size="small" color={buttonColor} />
        ) : (
          <Text style={[styles.buttonText, { color: buttonColor }]}>
            {buttonLabel}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
  },
  email: {
    fontSize: 12,
    marginTop: 1,
  },
  frequency: {
    fontSize: 12,
    marginTop: 2,
  },
  button: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
