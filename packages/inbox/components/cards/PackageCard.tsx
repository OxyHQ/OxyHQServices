import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/constants/theme';

interface PackageCardProps {
  data: Record<string, any>;
}

export function PackageCard({ data }: PackageCardProps) {
  const colors = useColors();

  const estimatedDelivery = data.estimatedDelivery
    ? new Date(data.estimatedDelivery).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.header, { backgroundColor: '#9334E620' }]}>
        <MaterialCommunityIcons name="package-variant" size={18} color="#9334E6" />
        <Text style={[styles.headerText, { color: '#9334E6' }]}>Package</Text>
      </View>
      <View style={styles.body}>
        {data.merchant && (
          <Text style={[styles.merchant, { color: colors.text }]}>{data.merchant}</Text>
        )}
        {data.status && (
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(data.status) + '20' }]}>
            <Text style={[styles.statusText, { color: getStatusColor(data.status) }]}>
              {data.status}
            </Text>
          </View>
        )}
        {data.carrier && (
          <View style={styles.row}>
            <MaterialCommunityIcons name="truck-outline" size={14} color={colors.secondaryText} />
            <Text style={[styles.carrier, { color: colors.secondaryText }]}>{data.carrier}</Text>
          </View>
        )}
        {data.trackingNumber && (
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.secondaryText }]}>Tracking</Text>
            <Text style={[styles.tracking, { color: colors.text }]}>{data.trackingNumber}</Text>
          </View>
        )}
        {estimatedDelivery && (
          <View style={styles.row}>
            <MaterialCommunityIcons name="calendar-check-outline" size={14} color={colors.secondaryText} />
            <Text style={[styles.delivery, { color: colors.secondaryText }]}>
              Est. {estimatedDelivery}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function getStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('deliver')) return '#34A853';
  if (s.includes('transit') || s.includes('shipped')) return '#1A73E8';
  if (s.includes('out for')) return '#F9AB00';
  return '#5F6368';
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  headerText: { fontSize: 13, fontWeight: '600' },
  body: { padding: 12, gap: 8 },
  merchant: { fontSize: 15, fontWeight: '600' },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  carrier: { fontSize: 13 },
  label: { fontSize: 12 },
  tracking: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  delivery: { fontSize: 13 },
});
