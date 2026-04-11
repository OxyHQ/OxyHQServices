/**
 * Settings navigation sidebar for desktop split-view.
 * Shows category links that navigate to setting sub-routes.
 */

import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Settings01Icon,
  SignatureIcon,
  Beach02Icon,
  PaintBrush01Icon,
  ArrowLeft01Icon,
  LabelIcon,
  NoteEditIcon,
  ContactBookIcon,
  FilterIcon,
  MailSend01Icon,
  ArrowDataTransferHorizontalIcon,
} from '@hugeicons/core-free-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/constants/theme';

const SECTIONS = [
  { key: 'general', label: 'General', icon: 'cog-outline' as const, hugeIcon: Settings01Icon },
  { key: 'signature', label: 'Signature', icon: 'signature-text' as const, hugeIcon: SignatureIcon },
  { key: 'vacation', label: 'Vacation Responder', icon: 'beach' as const, hugeIcon: Beach02Icon },
  { key: 'forwarding', label: 'Forwarding', icon: 'email-fast-outline' as const, hugeIcon: MailSend01Icon },
  { key: 'labels', label: 'Labels', icon: 'label-outline' as const, hugeIcon: LabelIcon },
  { key: 'filters', label: 'Filters & Rules', icon: 'filter-outline' as const, hugeIcon: FilterIcon },
  { key: 'contacts', label: 'Contacts', icon: 'contacts-outline' as const, hugeIcon: ContactBookIcon },
  { key: 'templates', label: 'Templates', icon: 'file-document-edit-outline' as const, hugeIcon: NoteEditIcon },
  { key: 'import-export', label: 'Import & Export', icon: 'import' as const, hugeIcon: ArrowDataTransferHorizontalIcon },
  { key: 'appearance', label: 'Appearance', icon: 'palette-outline' as const, hugeIcon: PaintBrush01Icon },
];

interface SettingsNavProps {
  activeSection?: string;
}

export function SettingsNav({ activeSection }: SettingsNavProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleSelect = useCallback(
    (key: string) => {
      router.replace(`/settings/${key}`);
    },
    [router],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={ArrowLeft01Icon as unknown as IconSvgElement} size={24} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.icon} />
          )}
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
      </View>

      <View style={styles.sections}>
        {SECTIONS.map((section) => {
          const isActive = activeSection === section.key;
          return (
            <TouchableOpacity
              key={section.key}
              style={[
                styles.sectionItem,
                isActive && { backgroundColor: colors.selectedRow },
              ]}
              onPress={() => handleSelect(section.key)}
              activeOpacity={0.7}
            >
              {Platform.OS === 'web' ? (
                <HugeiconsIcon
                  icon={section.hugeIcon as unknown as IconSvgElement}
                  size={20}
                  color={isActive ? colors.primary : colors.icon}
                />
              ) : (
                <MaterialCommunityIcons
                  name={section.icon as any}
                  size={20}
                  color={isActive ? colors.primary : colors.icon}
                />
              )}
              <Text
                style={[
                  styles.sectionLabel,
                  { color: isActive ? colors.primary : colors.text },
                  isActive && styles.sectionLabelActive,
                ]}
              >
                {section.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
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
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '500',
    marginLeft: 4,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  sections: {
    paddingTop: 8,
    paddingHorizontal: 8,
    gap: 2,
  },
  sectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  sectionLabel: {
    fontSize: 14,
  },
  sectionLabelActive: {
    fontWeight: '600',
  },
});
