/**
 * Settings navigation sidebar for desktop split-view.
 * Shows category links that navigate to setting sub-routes.
 */

import React, { useCallback, type ComponentProps } from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Text } from '@oxyhq/bloom/typography';

type MaterialCommunityIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
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

const SECTIONS: { key: string; label: string; icon: MaterialCommunityIconName; hugeIcon: IconSvgElement }[] = [
  { key: 'general', label: 'General', icon: 'cog-outline', hugeIcon: Settings01Icon as unknown as IconSvgElement },
  { key: 'signature', label: 'Signature', icon: 'signature-text', hugeIcon: SignatureIcon as unknown as IconSvgElement },
  { key: 'vacation', label: 'Vacation Responder', icon: 'beach', hugeIcon: Beach02Icon as unknown as IconSvgElement },
  { key: 'forwarding', label: 'Forwarding', icon: 'email-fast-outline', hugeIcon: MailSend01Icon as unknown as IconSvgElement },
  { key: 'labels', label: 'Labels', icon: 'label-outline', hugeIcon: LabelIcon as unknown as IconSvgElement },
  { key: 'filters', label: 'Filters & Rules', icon: 'filter-outline', hugeIcon: FilterIcon as unknown as IconSvgElement },
  { key: 'contacts', label: 'Contacts', icon: 'contacts-outline', hugeIcon: ContactBookIcon as unknown as IconSvgElement },
  { key: 'templates', label: 'Templates', icon: 'file-document-edit-outline', hugeIcon: NoteEditIcon as unknown as IconSvgElement },
  { key: 'import-export', label: 'Import & Export', icon: 'import', hugeIcon: ArrowDataTransferHorizontalIcon as unknown as IconSvgElement },
  { key: 'appearance', label: 'Appearance', icon: 'palette-outline', hugeIcon: PaintBrush01Icon as unknown as IconSvgElement },
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
                  icon={section.hugeIcon}
                  size={20}
                  color={isActive ? colors.primary : colors.icon}
                />
              ) : (
                <MaterialCommunityIcons
                  name={section.icon}
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
