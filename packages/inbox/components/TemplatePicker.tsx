/**
 * Template picker dropdown for inserting canned responses
 * into compose forms and inline replies.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
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

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useTemplates } from '@/hooks/queries/useTemplates';
import type { EmailTemplate } from '@/services/emailApi';

interface TemplatePickerProps {
  onSelect: (template: EmailTemplate) => void;
}

export function TemplatePicker({ onSelect }: TemplatePickerProps) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { data: templates = [] } = useTemplates();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<View>(null);

  // Close dropdown when clicking outside (web only)
  useEffect(() => {
    if (Platform.OS !== 'web' || !open) return;
    const handleClick = (e: MouseEvent) => {
      // Check if click is outside the dropdown
      const el = containerRef.current as unknown as HTMLElement | null;
      if (el && !el.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleSelect = useCallback(
    (template: EmailTemplate) => {
      onSelect(template);
      setOpen(false);
    },
    [onSelect],
  );

  if (templates.length === 0) return null;

  return (
    <View ref={containerRef} style={styles.container}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
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

      {open && (
        <View
          style={[
            styles.dropdown,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
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
        </View>
      )}
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
  dropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    minWidth: 240,
    maxWidth: 320,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: 'hidden',
    zIndex: 50,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }
      : { elevation: 4 }),
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
