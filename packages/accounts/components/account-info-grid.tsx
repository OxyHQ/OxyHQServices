import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface AccountInfoCard {
  id: string;
  icon: string;
  iconColor: string;
  title: string;
  value: string;
  onPress?: () => void;
}

interface AccountInfoGridProps {
  cards: AccountInfoCard[];
  onPressIn?: () => void;
}

export function AccountInfoGrid({ cards, onPressIn }: AccountInfoGridProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  return (
    <View style={styles.gridContainer}>
      {cards.map((card) => (
        <TouchableOpacity
          key={card.id}
          style={[styles.accountInfoCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPressIn={onPressIn}
          onPress={card.onPress}
          activeOpacity={card.onPress ? 0.7 : 1}
          disabled={!card.onPress}
        >
          <View style={[styles.accountInfoIcon, { backgroundColor: card.iconColor }]}>
            <MaterialCommunityIcons name={card.icon as any} size={20} color={darkenColor(card.iconColor)} />
          </View>
          <Text style={[styles.accountInfoTitle, { color: colors.secondaryText }]}>{card.title}</Text>
          <Text style={[styles.accountInfoValue, { color: colors.text }]} numberOfLines={1}>{card.value}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  } as const,
  accountInfoCard: {
    flex: 1,
    minWidth: '48%',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
  } as const,
  accountInfoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  } as const,
  accountInfoTitle: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  } as const,
  accountInfoValue: {
    fontSize: 16,
    fontWeight: '600',
  } as const,
});

