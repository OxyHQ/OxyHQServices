import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Card, CardHeader, CardBody } from '@oxyhq/bloom/card';
import { useColors } from '@/constants/theme';

interface BillCardProps {
  data: Record<string, any>;
}

export function BillCard({ data }: BillCardProps) {
  const colors = useColors();

  const formattedAmount = data.amount != null
    ? new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: data.currency || 'USD',
      }).format(data.amount)
    : null;

  const dueDate = data.dueDate
    ? new Date(data.dueDate).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : null;

  const isOverdue = data.dueDate ? new Date(data.dueDate) < new Date() : false;

  return (
    <Card variant="outlined">
      <CardHeader>
        <View style={[styles.header, { backgroundColor: '#F9AB0020' }]}>
          <MaterialCommunityIcons name="receipt" size={18} color="#F9AB00" />
          <Text style={[styles.headerText, { color: '#F9AB00' }]}>Bill</Text>
        </View>
      </CardHeader>
      <CardBody>
        <View style={styles.body}>
          {data.biller && (
            <Text style={[styles.biller, { color: colors.text }]}>{data.biller}</Text>
          )}
          {formattedAmount && (
            <Text style={[styles.amount, { color: colors.text }]}>{formattedAmount}</Text>
          )}
          {dueDate && (
            <View style={styles.row}>
              <MaterialCommunityIcons
                name="calendar-clock"
                size={14}
                color={isOverdue ? colors.danger : colors.secondaryText}
              />
              <Text style={[styles.dueDate, { color: isOverdue ? colors.danger : colors.secondaryText }]}>
                {isOverdue ? 'Overdue · ' : 'Due '}{dueDate}
              </Text>
            </View>
          )}
          {data.accountNumber && (
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.secondaryText }]}>Account</Text>
              <Text style={[styles.value, { color: colors.text }]}>{data.accountNumber}</Text>
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
  biller: { fontSize: 15, fontWeight: '600' },
  amount: { fontSize: 20, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dueDate: { fontSize: 13, fontWeight: '500' },
  label: { fontSize: 12 },
  value: { fontSize: 13, fontWeight: '600' },
});
