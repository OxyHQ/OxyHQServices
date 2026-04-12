/**
 * Template picker dropdown for inserting canned responses
 * into compose forms and inline replies.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { NoteEditIcon } from '@hugeicons/core-free-icons';
import * as Dialog from '@oxyhq/bloom/dialog';

import { useColors } from '@/constants/theme';
import { useTemplates } from '@/hooks/queries/useTemplates';
import type { EmailTemplate } from '@/services/emailApi';

interface TemplatePickerProps {
  onSelect: (template: EmailTemplate) => void;
}

export function TemplatePicker({ onSelect }: TemplatePickerProps) {
  const colors = useColors();
  const { data: templates = [] } = useTemplates();
  const control = Dialog.useDialogControl();

  const handleSelect = useCallback(
    (template: EmailTemplate) => {
      onSelect(template);
      control.close();
    },
    [onSelect, control],
  );

  if (templates.length === 0) return null;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={() => control.open()}
        style={styles.button}
        hitSlop={4}
      >
        {Platform.OS === 'web' ? (
          <HugeiconsIcon
            icon={NoteEditIcon as unknown as IconSvgElement}
            size={20}
            color={colors.icon}
          />
        ) : (
          <MaterialCommunityIcons
            name="file-document-edit-outline"
            size={20}
            color={colors.icon}
          />
        )}
      </TouchableOpacity>

      <Dialog.Outer control={control}>
        <Dialog.Handle />
        <Dialog.Inner label="Insert Template" contentContainerStyle={{ padding: 0 }}>
          <Text style={[styles.dropdownTitle, { color: colors.secondaryText }]}>
            Insert Template
          </Text>
          <ScrollView style={styles.dropdownScroll} bounces={false}>
            {templates.map((tpl) => (
              <TouchableOpacity
                key={tpl._id}
                style={[styles.dropdownItem, { borderBottomColor: colors.border }]}
                onPress={() => handleSelect(tpl)}
              >
                <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
                  {tpl.name}
                </Text>
                <Text style={[styles.itemPreview, { color: colors.secondaryText }]} numberOfLines={1}>
                  {tpl.body.replace(/\n/g, ' ').slice(0, 60)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Dialog.Inner>
      </Dialog.Outer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  button: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  dropdownTitle: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  dropdownScroll: {
    maxHeight: 200,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
  },
  itemPreview: {
    fontSize: 12,
  },
});
