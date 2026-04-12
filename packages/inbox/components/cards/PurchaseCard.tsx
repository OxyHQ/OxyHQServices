import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Card, CardHeader, CardBody } from '@oxyhq/bloom/card';
import { useColors } from '@/constants/theme';

interface PurchaseCardProps {
  data: Record<string, any>;
}

export function PurchaseCard({ data }: PurchaseCardProps) {
  const colors = useColors();

  const formattedAmount = data.amount != null
    ? new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: data.currency || 'USD',
      }).format(data.amount)
    : null;

  return (
    <Card variant="outlined">
      <CardHeader>
        <View style={[styles.header, { backgroundColor: '#34A85320' }]}>
          <MaterialCommunityIcons name="shopping-outline" size={18} color="#34A853" />
          <Text style={[styles.headerText, { color: '#34A853' }]}>Purchase</Text>
        </View>
      </CardHeader>
      <CardBody>
        <View style={styles.body}>
          {data.merchant && (
            <Text style={[styles.merchant, { color: colors.text }]}>{data.merchant}</Text>
          )}
          {formattedAmount && (
            <Text style={[styles.amount, { color: colors.text }]}>{formattedAmount}</Text>
          )}
          {data.orderNumber && (
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.secondaryText }]}>Order #</Text>
              <Text style={[styles.value, { color: colors.text }]}>{data.orderNumber}</Text>
            </View>
          )}
          {Array.isArray(data.items) && data.items.length > 0 && (
            <View style={styles.items}>
              {data.items.slice(0, 3).map((item: string, i: number) => (
                <Text key={i} style={[styles.item, { color: colors.secondaryText }]}>
                  · {item}
                </Text>
              ))}
              {data.items.length > 3 && (
                <Text style={[styles.item, { color: colors.secondaryText }]}>
                  +{data.items.length - 3} more
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
  body: { gap: 6 },
  merchant: { fontSize: 15, fontWeight: '600' },
  amount: { fontSize: 20, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 12 },
  value: { fontSize: 13, fontWeight: '600' },
  items: { gap: 2, marginTop: 4 },
  item: { fontSize: 13 },
});
