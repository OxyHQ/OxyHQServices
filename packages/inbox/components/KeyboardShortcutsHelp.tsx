/**
 * Keyboard shortcuts cheat-sheet modal.
 *
 * Surfaces the Gmail-style shortcuts already wired up in `useKeyboardShortcuts`.
 * Triggered by pressing `?` (Shift+/) anywhere outside an input.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Dialog, type DialogControlProps } from '@oxyhq/bloom';
import { Text } from '@oxyhq/bloom/typography';
import { useColors } from '@/constants/theme';

interface ShortcutRow {
  key: string;
  action: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { key: 'c', action: 'Compose' },
  { key: 'r', action: 'Reply' },
  { key: 'a', action: 'Reply all' },
  { key: 'f', action: 'Forward' },
  { key: 'e', action: 'Archive' },
  { key: '#', action: 'Delete' },
  { key: 'j', action: 'Next message' },
  { key: 'k', action: 'Previous message' },
  { key: 's', action: 'Star / unstar' },
  { key: 'u', action: 'Mark unread' },
  { key: '/', action: 'Search' },
  { key: '?', action: 'This help' },
];

interface KeyboardShortcutsHelpProps {
  control: DialogControlProps;
}

export function KeyboardShortcutsHelp({ control }: KeyboardShortcutsHelpProps) {
  const colors = useColors();

  return (
    <Dialog
      control={control}
      testID="keyboard-shortcuts-help"
      title="Keyboard shortcuts"
      actions={[{ label: 'Close', color: 'cancel' }]}
    >
      <View style={styles.list}>
        {SHORTCUTS.map((row) => (
          <View key={row.key} style={styles.row}>
            <View style={[styles.kbd, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.kbdLabel, { color: colors.text }]}>{row.key}</Text>
            </View>
            <Text style={[styles.action, { color: colors.text }]}>{row.action}</Text>
          </View>
        ))}
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: 8,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  kbd: {
    minWidth: 32,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kbdLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  action: {
    fontSize: 14,
    flex: 1,
  },
});
