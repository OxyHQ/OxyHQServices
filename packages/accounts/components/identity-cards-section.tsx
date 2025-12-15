import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface IdentityCard {
  id: string;
  customIcon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  showChevron?: boolean;
}

interface IdentityCardsSectionProps {
  cards: IdentityCard[];
  onPressIn?: () => void;
}

export function IdentityCardsSection({ cards, onPressIn }: IdentityCardsSectionProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { width } = useWindowDimensions();

  const cardWidth = useMemo(() => {
    const padding = 16;
    const gap = 12;
    return ((width - padding * 2 - gap) / 2) * 1.5;
  }, [width]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scrollView}
      contentContainerStyle={styles.horizontalScrollContent}
    >
      {cards.map((card) => (
        <TouchableOpacity
          key={card.id}
          style={[styles.identityCard, { width: cardWidth, backgroundColor: colors.card, borderColor: colors.border }]}
          onPressIn={onPressIn}
          onPress={card.onPress}
          activeOpacity={0.7}
        >
          {card.customIcon}
          <Text style={[styles.identityCardTitle, { color: colors.text }]}>{card.title}</Text>
          <Text style={[styles.identityCardSubtitle, { color: colors.secondaryText }]}>{card.subtitle}</Text>
          {card.showChevron && (
            <Ionicons name="chevron-forward" size={20} color={colors.secondaryText} style={styles.identityChevron} />
          )}
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
  identityCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    position: 'relative',
  } as const,
  identityCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
  } as const,
  identityCardSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  } as const,
  identityChevron: {
    position: 'absolute',
    top: 20,
    right: 20,
  } as const,
});

