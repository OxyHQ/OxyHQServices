import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';
import { SUPPORTED_LANGUAGES, type LanguageMetadata } from '@oxyhq/core';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';
import { SUPPORTED_LOCALES } from '@/lib/i18n';

interface LanguageSelectorProps {
  visible: boolean;
  onClose: () => void;
  onChange?: (locale: Locale) => void;
}

const ANIM_IN = { duration: 250, easing: Easing.out(Easing.ease) } as const;
const ANIM_OUT = { duration: 200, easing: Easing.in(Easing.ease) } as const;

export function LanguageSelector({
  visible,
  onClose,
  onChange,
}: LanguageSelectorProps) {
  const colors = useColors();
  const { mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { t, locale, setLocale } = useTranslation();
  const [savingLocale, setSavingLocale] = useState<Locale | null>(null);

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, ANIM_IN);
      translateY.value = withTiming(0, ANIM_IN);
    } else {
      opacity.value = withTiming(0, ANIM_OUT);
      translateY.value = withTiming(20, ANIM_OUT);
    }
  }, [visible, opacity, translateY]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  // Only show supported locales that we know about in core's language list.
  const items = useMemo<LanguageMetadata[]>(
    () =>
      SUPPORTED_LANGUAGES.filter((lang) =>
        SUPPORTED_LOCALES.includes(lang.id as Locale),
      ),
    [],
  );

  const handleSelect = useCallback(
    async (next: Locale) => {
      if (next === locale) {
        onClose();
        return;
      }
      setSavingLocale(next);
      try {
        await setLocale(next);
        onChange?.(next);
        onClose();
      } finally {
        setSavingLocale(null);
      }
    },
    [locale, setLocale, onChange, onClose],
  );

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.overlay, overlayStyle]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              marginTop: insets.top,
              marginBottom: insets.bottom,
              marginLeft: insets.left,
              marginRight: insets.right,
            },
            sheetStyle,
          ]}
          pointerEvents="box-none"
        >
          <BlurView
            intensity={100}
            tint={mode === 'dark' ? 'dark' : 'light'}
            style={[
              styles.sheet,
              {
                backgroundColor:
                  mode === 'dark'
                    ? 'rgba(28, 28, 30, 0.95)'
                    : 'rgba(248, 249, 250, 0.95)',
              },
            ]}
          >
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.text }]}>
                {t('security.language.modalTitle')}
              </Text>
              <Text
                style={[styles.subtitle, { color: colors.textSecondary }]}
              >
                {t('security.language.modalSubtitle')}
              </Text>
            </View>

            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {items.map((lang) => {
                const isActive = lang.id === locale;
                const isSaving = savingLocale === lang.id;
                return (
                  <TouchableOpacity
                    key={lang.id}
                    style={[
                      styles.row,
                      {
                        backgroundColor: isActive
                          ? mode === 'dark'
                            ? 'rgba(255,255,255,0.08)'
                            : 'rgba(0,0,0,0.04)'
                          : 'transparent',
                      },
                    ]}
                    onPress={() => handleSelect(lang.id as Locale)}
                    disabled={isSaving}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={lang.nativeName}
                  >
                    <Text style={styles.flag}>{lang.flag}</Text>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>
                        {lang.nativeName}
                      </Text>
                      {lang.nativeName !== lang.name && (
                        <Text
                          style={[
                            styles.rowSubtitle,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {lang.name}
                        </Text>
                      )}
                    </View>
                    {isActive && (
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={22}
                        color={colors.success}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.closeButton,
                {
                  backgroundColor:
                    mode === 'dark'
                      ? 'rgba(255,255,255,0.1)'
                      : 'rgba(0,0,0,0.05)',
                },
              ]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Text style={[styles.closeButtonText, { color: colors.text }]}>
                {t('common.close')}
              </Text>
            </TouchableOpacity>
          </BlurView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheetContainer: {
    width: '100%',
    maxWidth: 480,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    paddingTop: 8,
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  list: {
    maxHeight: 420,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 16,
  },
  flag: {
    fontSize: 28,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  rowSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    marginHorizontal: 24,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
