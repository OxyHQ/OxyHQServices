/**
 * Sentiment Indicator component.
 *
 * Shows visual indicator for email sentiment/tone:
 * - Urgent (red alert)
 * - Frustrated/needs attention (orange warning)
 * - Positive (green)
 * - Formal (gray)
 * - Action requested (blue)
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Alert01Icon, ThumbsUpIcon, SentIcon } from '@hugeicons/core-free-icons';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import type { SentimentResult } from '@/hooks/queries/useSentimentAnalysis';

interface SentimentIndicatorProps {
  sentiment: SentimentResult | null;
  size?: 'small' | 'medium';
  showLabel?: boolean;
}

export function SentimentIndicator({
  sentiment,
  size = 'small',
  showLabel = false,
}: SentimentIndicatorProps) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

  if (!sentiment) return null;

  const iconSize = size === 'small' ? 12 : 16;
  const fontSize = size === 'small' ? 10 : 12;

  // Use web-specific icons when available
  const renderIcon = () => {
    if (Platform.OS === 'web') {
      switch (sentiment.type) {
        case 'urgent':
        case 'frustrated':
          return (
            <HugeiconsIcon
              icon={Alert01Icon as unknown as IconSvgElement}
              size={iconSize}
              color={sentiment.color}
            />
          );
        case 'positive':
          return (
            <HugeiconsIcon
              icon={ThumbsUpIcon as unknown as IconSvgElement}
              size={iconSize}
              color={sentiment.color}
            />
          );
        case 'request':
          return (
            <HugeiconsIcon
              icon={SentIcon as unknown as IconSvgElement}
              size={iconSize}
              color={sentiment.color}
            />
          );
        default:
          return (
            <MaterialCommunityIcons
              name={sentiment.icon as any}
              size={iconSize}
              color={sentiment.color}
            />
          );
      }
    }

    return (
      <MaterialCommunityIcons
        name={sentiment.icon as any}
        size={iconSize}
        color={sentiment.color}
      />
    );
  };

  if (!showLabel) {
    // Just the icon for compact display
    return (
      <View style={[styles.iconOnly, { backgroundColor: sentiment.color + '15' }]}>
        {renderIcon()}
      </View>
    );
  }

  // Full badge with label
  return (
    <View
      style={[
        styles.badge,
        size === 'medium' && styles.badgeMedium,
        { backgroundColor: sentiment.color + '15' },
      ]}
    >
      {renderIcon()}
      <Text style={[styles.label, { color: sentiment.color, fontSize }]}>
        {sentiment.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  iconOnly: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeMedium: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  label: {
    fontWeight: '600',
  },
});
