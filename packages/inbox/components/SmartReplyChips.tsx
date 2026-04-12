/**
 * Smart Reply Chips component.
 *
 * Displays AI-generated quick reply suggestions as tappable chips.
 * Tapping a chip inserts the text into the reply composer.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
} from 'react-native';
import { Loading } from '@oxyhq/bloom/loading';
import { Chip } from '@oxyhq/bloom/chip';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { AiMail01Icon } from '@hugeicons/core-free-icons';

import { useColors } from '@/constants/theme';
import { useSmartReplies } from '@/hooks/queries/useSmartReplies';
import type { Message } from '@/services/emailApi';

interface SmartReplyChipsProps {
  message: Message;
  onSelectReply: (text: string) => void;
}

export function SmartReplyChips({ message, onSelectReply }: SmartReplyChipsProps) {
  const colors = useColors();
  const { replies, isLoading } = useSmartReplies(message);

  // Don't render anything if no suggestions and not loading
  if (!isLoading && replies.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {Platform.OS === 'web' ? (
          <HugeiconsIcon
            icon={AiMail01Icon as unknown as IconSvgElement}
            size={14}
            color={colors.primary}
          />
        ) : (
          <MaterialCommunityIcons
            name="creation"
            size={14}
            color={colors.primary}
          />
        )}
        <Text style={[styles.label, { color: colors.secondaryText }]}>
          Quick replies
        </Text>
        {isLoading && (
          <Loading variant="inline" size="small" />
        )}
      </View>

      <View style={styles.chips}>
        {isLoading ? (
          // Skeleton loading state
          <>
            <View style={[styles.chipSkeleton, { backgroundColor: colors.border }]} />
            <View style={[styles.chipSkeleton, styles.chipSkeletonMedium, { backgroundColor: colors.border }]} />
            <View style={[styles.chipSkeleton, styles.chipSkeletonShort, { backgroundColor: colors.border }]} />
          </>
        ) : (
          replies.map((reply, index) => (
            <Chip
              key={index}
              variant="outlined"
              color="primary"
              onPress={() => onSelectReply(reply)}
            >
              {reply}
            </Chip>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipSkeleton: {
    height: 34,
    width: 120,
    borderRadius: 18,
    opacity: 0.3,
  },
  chipSkeletonMedium: {
    width: 160,
  },
  chipSkeletonShort: {
    width: 90,
  },
});
