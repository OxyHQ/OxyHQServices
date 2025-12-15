import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scrollView}
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
          <Text style={[styles.quickActionTitle, { color: colors.text }]}>{action.title}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    marginHorizontal: -16, // Extend to screen edges (compensate for parent padding)
  } as const,
  horizontalScrollContent: {
    paddingLeft: 16,
    paddingRight: 16,
    gap: 12,
  } as const,
  quickActionCard: {
    width: 100,
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
  } as const,
});

