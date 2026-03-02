import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface EventCardProps {
  data: Record<string, any>;
}

export function EventCard({ data }: EventCardProps) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

  const startTime = data.startTime
    ? new Date(data.startTime).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const endTime = data.endTime
    ? new Date(data.endTime).toLocaleString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.header, { backgroundColor: '#EA433520' }]}>
        <MaterialCommunityIcons name="calendar" size={18} color="#EA4335" />
        <Text style={[styles.headerText, { color: '#EA4335' }]}>Event</Text>
      </View>
      <View style={styles.body}>
        {data.title && (
          <Text style={[styles.title, { color: colors.text }]}>{data.title}</Text>
        )}
        {startTime && (
          <View style={styles.row}>
            <MaterialCommunityIcons name="clock-outline" size={14} color={colors.secondaryText} />
            <Text style={[styles.time, { color: colors.secondaryText }]}>
              {startTime}{endTime ? ` – ${endTime}` : ''}
            </Text>
          </View>
        )}
        {data.location && (
          <View style={styles.row}>
            <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.secondaryText} />
            <Text style={[styles.location, { color: colors.secondaryText }]}>{data.location}</Text>
          </View>
        )}
        {data.organizer && (
          <View style={styles.row}>
            <MaterialCommunityIcons name="account-outline" size={14} color={colors.secondaryText} />
            <Text style={[styles.organizer, { color: colors.secondaryText }]}>{data.organizer}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  headerText: { fontSize: 13, fontWeight: '600' },
  body: { padding: 12, gap: 8 },
  title: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { fontSize: 13 },
  location: { fontSize: 13, flex: 1 },
  organizer: { fontSize: 13 },
});
