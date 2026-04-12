import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Card, CardHeader, CardBody } from '@oxyhq/bloom/card';
import { useColors } from '@/constants/theme';

interface TripCardProps {
  data: Record<string, any>;
}

export function TripCard({ data }: TripCardProps) {
  const colors = useColors();

  const departureTime = data.departureTime
    ? new Date(data.departureTime).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const arrivalTime = data.arrivalTime
    ? new Date(data.arrivalTime).toLocaleString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <Card variant="outlined">
      <CardHeader>
        <View style={[styles.header, { backgroundColor: '#1A73E820' }]}>
          <MaterialCommunityIcons name="airplane" size={18} color="#1A73E8" />
          <Text style={[styles.headerText, { color: '#1A73E8' }]}>Trip</Text>
        </View>
      </CardHeader>
      <CardBody>
        <View style={styles.body}>
          {data.airline && (
            <Text style={[styles.airline, { color: colors.text }]}>
              {data.airline} {data.flightNumber ? `· ${data.flightNumber}` : ''}
            </Text>
          )}
          {(data.departure || data.arrival) && (
            <View style={styles.route}>
              <Text style={[styles.city, { color: colors.text }]}>{data.departure || '—'}</Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color={colors.secondaryText} />
              <Text style={[styles.city, { color: colors.text }]}>{data.arrival || '—'}</Text>
            </View>
          )}
          {departureTime && (
            <Text style={[styles.time, { color: colors.secondaryText }]}>
              {departureTime}{arrivalTime ? ` → ${arrivalTime}` : ''}
            </Text>
          )}
          {data.confirmationCode && (
            <View style={styles.codeRow}>
              <Text style={[styles.codeLabel, { color: colors.secondaryText }]}>Confirmation</Text>
              <Text style={[styles.codeValue, { color: colors.text }]}>{data.confirmationCode}</Text>
            </View>
          )}
          {data.hotel && (
            <View style={styles.codeRow}>
              <MaterialCommunityIcons name="bed-outline" size={14} color={colors.secondaryText} />
              <Text style={[styles.hotelText, { color: colors.text }]}>{data.hotel}</Text>
              {data.checkIn && (
                <Text style={[styles.time, { color: colors.secondaryText }]}>
                  {new Date(data.checkIn).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {data.checkOut ? ` – ${new Date(data.checkOut).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
                </Text>
              )}
            </View>
          )}
        </View>
      </CardBody>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  headerText: { fontSize: 13, fontWeight: '600' },
  body: { gap: 8 },
  airline: { fontSize: 15, fontWeight: '600' },
  route: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  city: { fontSize: 14, fontWeight: '500' },
  time: { fontSize: 13 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  codeLabel: { fontSize: 12 },
  codeValue: { fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  hotelText: { fontSize: 13, flex: 1 },
});
