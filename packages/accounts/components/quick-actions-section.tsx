import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { HorizontalScrollSection } from './horizontal-scroll-section';

export interface QuickAction {
  id: string;
  icon: string;
  iconColor: string;
  title: string;
  onPress: () => void;
}

interface QuickActionsSectionProps {
  actions: QuickAction[];
  onPressIn?: () => void;
}

export function QuickActionsSection({ actions, onPressIn }: QuickActionsSectionProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  return (
    <HorizontalScrollSection
      onPressIn={onPressIn}
      scrollViewStyle={styles.scrollView}
      contentContainerStyle={styles.horizontalScrollContent}
    >
      {actions.map((action) => (
        <TouchableOpacity
          key={action.id}
          style={[styles.quickActionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPressIn={onPressIn}
          onPress={action.onPress}
          activeOpacity={0.7}
        >
          <View style={[styles.quickActionIcon, { backgroundColor: action.iconColor }]}>
            <MaterialCommunityIcons name={action.icon as any} size={24} color={darkenColor(action.iconColor)} />
          </View>
          <Text
            style={[styles.quickActionTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {action.title}
          </Text>
        </TouchableOpacity>
      ))}
    </HorizontalScrollSection>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    // Styles handled by HorizontalScrollSection
  } as const,
  horizontalScrollContent: {
    gap: 12,
  } as const,
  quickActionCard: {
    minWidth: 100,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  } as const,
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
  quickActionTitle: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    flexShrink: 0,
  } as const,
});

