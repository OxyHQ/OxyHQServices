import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Linking } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface EventCardProps {
  data: Record<string, any>;
}

/**
 * Format a Date as an iCalendar DTSTART/DTEND value (UTC).
 * Returns e.g. "20260415T090000Z"
 */
function toIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Generate an iCalendar (.ics) file content string from event data.
 */
function generateIcs(data: Record<string, any>): string {
  const start = data.startTime ? new Date(data.startTime) : new Date();
  // Default to 1 hour duration if no end time
  const end = data.endTime
    ? new Date(data.endTime)
    : new Date(start.getTime() + 60 * 60 * 1000);

  const escapeIcs = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Oxy Inbox//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
  ];

  if (data.title) lines.push(`SUMMARY:${escapeIcs(data.title)}`);
  if (data.location) lines.push(`LOCATION:${escapeIcs(data.location)}`);

  // Combine description and organizer into a single DESCRIPTION field
  const descParts: string[] = [];
  if (data.description) descParts.push(data.description);
  if (data.organizer) descParts.push(`Organizer: ${data.organizer}`);
  if (descParts.length > 0) lines.push(`DESCRIPTION:${escapeIcs(descParts.join('\\n'))}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n');
}

/**
 * Build a Google Calendar "Add Event" URL from event data.
 */
function buildGoogleCalendarUrl(data: Record<string, any>): string {
  const start = data.startTime ? new Date(data.startTime) : new Date();
  const end = data.endTime
    ? new Date(data.endTime)
    : new Date(start.getTime() + 60 * 60 * 1000);

  const formatGcalDate = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: data.title || 'Event',
    dates: `${formatGcalDate(start)}/${formatGcalDate(end)}`,
  });
  if (data.location) params.set('location', data.location);
  if (data.description) params.set('details', data.description);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
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

  const handleAddToCalendar = useCallback(async () => {
    const icsContent = generateIcs(data);

    if (Platform.OS === 'web') {
      // Web: create a Blob and trigger download
      const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(data.title || 'event').replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else {
      // Native: use expo-file-system and expo-sharing
      try {
        const FileSystem = await import('expo-file-system');
        const Sharing = await import('expo-sharing');

        const filename = `${(data.title || 'event').replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
        const fileUri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, icsContent, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'text/calendar',
            dialogTitle: 'Add to Calendar',
          });
        }
      } catch {
        // expo-file-system or expo-sharing not available — ignore gracefully
      }
    }
  }, [data]);

  const handleOpenGoogleCalendar = useCallback(() => {
    const url = buildGoogleCalendarUrl(data);
    Linking.openURL(url);
  }, [data]);

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

        {/* Calendar action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.border }]}
            onPress={handleAddToCalendar}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="calendar-plus" size={16} color={colors.text} />
            <Text style={[styles.actionText, { color: colors.text }]}>Add to Calendar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.border }]}
            onPress={handleOpenGoogleCalendar}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="google" size={16} color={colors.text} />
            <Text style={[styles.actionText, { color: colors.text }]}>Google Calendar</Text>
          </TouchableOpacity>
        </View>
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
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
