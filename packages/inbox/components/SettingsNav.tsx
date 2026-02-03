/**
 * Settings navigation sidebar for desktop split-view.
 * Shows category links that navigate to setting sub-routes.
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

const SECTIONS = [
  { key: 'general', label: 'General', icon: 'cog-outline' as const },
  { key: 'signature', label: 'Signature', icon: 'signature-text' as const },
  { key: 'vacation', label: 'Vacation Responder', icon: 'beach' as const },
  { key: 'appearance', label: 'Appearance', icon: 'palette-outline' as const },
];

interface SettingsNavProps {
  activeSection?: string;
}

export function SettingsNav({ activeSection }: SettingsNavProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

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
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.icon} />
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
              <MaterialCommunityIcons
                name={section.icon as any}
                size={20}
                color={isActive ? colors.primary : colors.icon}
              />
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
