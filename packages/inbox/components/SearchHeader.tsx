/**
 * Reusable Gmail-style search header bar.
 *
 * Centered with max width, used on both inbox (as a button) and search (as an input).
 */

import React, { useMemo, forwardRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Menu01Icon, ArrowLeft01Icon, Cancel01Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const HUGE_ICON_MAP: Record<string, IconSvgElement> = {
  menu: Menu01Icon as unknown as IconSvgElement,
  'arrow-left': ArrowLeft01Icon as unknown as IconSvgElement,
};

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface SearchHeaderProps {
  /** Left icon action (e.g. open drawer, go back) */
  onLeftIcon: () => void;
  /** Left icon name */
  leftIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  /** If provided, renders as a tappable placeholder instead of an input */
  placeholder?: string;
  /** Tap handler when in placeholder mode */
  onPress?: () => void;
  /** Input value (active search mode) */
  value?: string;
  /** Input change handler (active search mode) */
  onChangeText?: (text: string) => void;
  /** Submit handler (active search mode) */
  onSubmitEditing?: () => void;
  /** Clear button handler */
  onClear?: () => void;
  /** Auto focus the input */
  autoFocus?: boolean;
}

export const SearchHeader = forwardRef<TextInput, SearchHeaderProps>(function SearchHeader(
  {
    onLeftIcon,
    leftIcon = 'menu',
    placeholder = 'Search mail',
    onPress,
    value,
    onChangeText,
    onSubmitEditing,
    onClear,
    autoFocus,
  },
  ref,
) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

  const isInputMode = onChangeText !== undefined;

  return (
    <View style={[styles.wrapper, { paddingTop: insets.top + 8, backgroundColor: colors.background }]}>
      <View style={styles.bar}>
        {isInputMode ? (
          <>
            <TouchableOpacity onPress={onLeftIcon} style={styles.iconButton}>
              {Platform.OS === 'web' && HUGE_ICON_MAP[leftIcon] ? (
                <HugeiconsIcon icon={HUGE_ICON_MAP[leftIcon]} size={24} color={colors.icon} />
              ) : (
                <MaterialCommunityIcons name={leftIcon} size={24} color={colors.icon} />
              )}
            </TouchableOpacity>
            <TextInput
              ref={ref}
              style={[styles.input, { color: colors.searchText, backgroundColor: colors.searchBackground }]}
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              placeholderTextColor={colors.searchPlaceholder}
              returnKeyType="search"
              onSubmitEditing={onSubmitEditing}
              autoFocus={autoFocus}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {value && value.length > 0 && onClear && (
              <TouchableOpacity onPress={onClear} style={styles.iconButton}>
                {Platform.OS === 'web' ? (
                  <HugeiconsIcon icon={Cancel01Icon as unknown as IconSvgElement} size={20} color={colors.icon} />
                ) : (
                  <MaterialCommunityIcons name="close" size={20} color={colors.icon} />
                )}
              </TouchableOpacity>
            )}
          </>
        ) : (
          <TouchableOpacity
            style={[styles.pillButton, { backgroundColor: colors.searchBackground }]}
            onPress={onPress}
            activeOpacity={0.8}
          >
            <TouchableOpacity onPress={onLeftIcon} activeOpacity={0.7}>
              {Platform.OS === 'web' && HUGE_ICON_MAP[leftIcon] ? (
                <HugeiconsIcon icon={HUGE_ICON_MAP[leftIcon]} size={24} color={colors.icon} />
              ) : (
                <MaterialCommunityIcons name={leftIcon} size={24} color={colors.icon} />
              )}
            </TouchableOpacity>
            <Text style={[styles.placeholderText, { color: colors.searchPlaceholder }]}>
              {placeholder}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

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
    gap: 4,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  input: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  pillButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 28,
    paddingHorizontal: 16,
    gap: 12,
  },
  placeholderText: {
    flex: 1,
    fontSize: 16,
  },
});
