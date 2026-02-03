/**
 * Toolbar shown when messages are selected in multi-select mode.
 * Replaces SearchHeader with count + bulk action buttons.
 */

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Cancel01Icon,
  Archive01Icon,
  Delete01Icon,
  StarIcon,
  MailOpen01Icon,
} from '@hugeicons/core-free-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface SelectionToolbarProps {
  count: number;
  onClose: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onStar: () => void;
  onMarkRead: () => void;
}

function ToolbarButton({
  onPress,
  icon,
  hugeIcon,
  color,
}: {
  onPress: () => void;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  hugeIcon: IconSvgElement;
  color: string;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.actionButton} activeOpacity={0.7}>
      {Platform.OS === 'web' ? (
        <HugeiconsIcon icon={hugeIcon} size={22} color={color} />
      ) : (
        <MaterialCommunityIcons name={icon} size={22} color={color} />
      )}
    </TouchableOpacity>
  );
}

export function SelectionToolbar({
  count,
  onClose,
  onArchive,
  onDelete,
  onStar,
  onMarkRead,
}: SelectionToolbarProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

  return (
    <View style={[styles.wrapper, { paddingTop: insets.top + 8, backgroundColor: colors.background }]}>
      <View style={styles.bar}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.7}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={Cancel01Icon as unknown as IconSvgElement} size={22} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name="close" size={22} color={colors.icon} />
          )}
        </TouchableOpacity>

        <Text style={[styles.count, { color: colors.text }]}>{count}</Text>

        <View style={styles.spacer} />

        <ToolbarButton
          onPress={onArchive}
          icon="archive-outline"
          hugeIcon={Archive01Icon as unknown as IconSvgElement}
          color={colors.icon}
        />
        <ToolbarButton
          onPress={onDelete}
          icon="delete-outline"
          hugeIcon={Delete01Icon as unknown as IconSvgElement}
          color={colors.icon}
        />
        <ToolbarButton
          onPress={onStar}
          icon="star-outline"
          hugeIcon={StarIcon as unknown as IconSvgElement}
          color={colors.icon}
        />
        <ToolbarButton
          onPress={onMarkRead}
          icon="email-open-outline"
          hugeIcon={MailOpen01Icon as unknown as IconSvgElement}
          color={colors.icon}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  bar: {
    width: '100%',
    maxWidth: 720,
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    gap: 4,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  count: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 4,
  },
  spacer: {
    flex: 1,
  },
  actionButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
});
