/**
 * Stale Thread Banner component.
 *
 * Shows a gentle nudge when the user hasn't responded to a thread
 * that appears to need a reply.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Clock01Icon, Cancel01Icon, MailReply01Icon } from '@hugeicons/core-free-icons';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import type { StaleThreadInfo } from '@/hooks/queries/useStaleThread';

interface StaleThreadBannerProps {
  staleInfo: StaleThreadInfo | null;
  onReply?: () => void;
  onDismiss?: () => void;
}

export function StaleThreadBanner({ staleInfo, onReply, onDismiss }: StaleThreadBannerProps) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const [dismissed, setDismissed] = useState(false);

  if (!staleInfo || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  // Different colors based on how stale
  const isVeryStale = staleInfo.daysSinceReceived >= 7;
  const bannerColor = isVeryStale ? '#E53935' : '#FF9800'; // Red for very stale, orange for stale
  const bgColor = bannerColor + '10';
  const borderColor = bannerColor + '30';

  return (
    <View style={[styles.container, { backgroundColor: bgColor, borderColor }]}>
      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: bannerColor + '20' }]}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon
              icon={Clock01Icon as unknown as IconSvgElement}
              size={16}
              color={bannerColor}
            />
          ) : (
            <MaterialCommunityIcons name="clock-alert-outline" size={16} color={bannerColor} />
          )}
        </View>
        <View style={styles.textContainer}>
          <Text style={[styles.message, { color: colors.text }]}>{staleInfo.message}</Text>
          {staleInfo.reason === 'unanswered_question' && (
            <Text style={[styles.hint, { color: colors.secondaryText }]}>
              Consider sending a quick reply
            </Text>
          )}
        </View>
      </View>

      <View style={styles.actions}>
        {onReply && (
          <TouchableOpacity
            style={[styles.replyButton, { backgroundColor: bannerColor }]}
            onPress={onReply}
            activeOpacity={0.8}
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon
                icon={MailReply01Icon as unknown as IconSvgElement}
                size={14}
                color="#FFFFFF"
              />
            ) : (
              <MaterialCommunityIcons name="reply" size={14} color="#FFFFFF" />
            )}
            <Text style={styles.replyButtonText}>Reply</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={handleDismiss}
          hitSlop={8}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon
              icon={Cancel01Icon as unknown as IconSvgElement}
              size={16}
              color={colors.icon}
            />
          ) : (
            <MaterialCommunityIcons name="close" size={16} color={colors.icon} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  message: {
    fontSize: 13,
    fontWeight: '500',
  },
  hint: {
    fontSize: 11,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  replyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  replyButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  dismissButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
});
