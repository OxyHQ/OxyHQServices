/**
 * Smart Reply Chips component.
 *
 * Displays AI-generated quick reply suggestions as tappable chips.
 * Tapping a chip inserts the text into the reply composer.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { Loading } from '@oxyhq/bloom/loading';
import { Chip } from '@oxyhq/bloom/chip';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { AiMail01Icon } from '@hugeicons/core-free-icons';

import { useColors } from '@/constants/theme';
import { useSmartReplies } from '@/hooks/queries/useSmartReplies';
import { useInboxPrefs } from '@/contexts/inbox-prefs-context';
import type { Message } from '@/services/emailApi';

interface SmartReplyChipsProps {
  message: Message;
  onSelectReply: (text: string) => void;
}

export function SmartReplyChips({ message, onSelectReply }: SmartReplyChipsProps) {
  const colors = useColors();
  const { prefs } = useInboxPrefs();
  const [hasRequestedReplies, setHasRequestedReplies] = useState(false);
  const { replies, isLoading, refetch } = useSmartReplies(message);

  const handleGenerateReplies = useCallback(() => {
    setHasRequestedReplies(true);
    void refetch();
  }, [refetch]);

  // Smart Reply is opt-in; render nothing when the user disabled it.
  if (!prefs.aiSmartReply) {
    return null;
  }

  if (!hasRequestedReplies) {
    return (
      <View style={styles.container}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={handleGenerateReplies}
          style={[styles.generateButton, { borderColor: colors.border }]}
        >
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
          <Text style={[styles.generateText, { color: colors.primary }]}>
            Generate quick replies with AI
          </Text>
        </TouchableOpacity>
        <Text style={[styles.privacyText, { color: colors.secondaryText }]}>
          Sends this email to Alia after a sensitive-content check.
        </Text>
      </View>
    );
  }

  // Don't render anything if no suggestions and not loading after an explicit request.
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
            <Skeleton.Pill size={34} style={styles.chipSkeletonPill} />
            <Skeleton.Pill size={34} style={styles.chipSkeletonPillMedium} />
            <Skeleton.Pill size={34} style={styles.chipSkeletonPillShort} />
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
  generateButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  generateText: {
    fontSize: 13,
    fontWeight: '600',
  },
  privacyText: {
    fontSize: 11,
    lineHeight: 14,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipSkeletonPill: {
    width: 120,
  },
  chipSkeletonPillMedium: {
    width: 160,
  },
  chipSkeletonPillShort: {
    width: 90,
  },
});
