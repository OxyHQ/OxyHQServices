import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { AccountCard } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { CivicBadge } from '@/components/civic/CivicBadge';
import { useValidatorInbox } from '@/hooks/useValidatorInbox';
import { prettyActionType } from '@/lib/civic/validation-format';
import { useTranslation } from '@/lib/i18n';

/**
 * Validator inbox — the citizen-duty queue.
 *
 * Lists the pending validation requests this user was randomly selected to judge.
 * Tapping one opens the vote screen. Live queue (the SDK never caches it); the
 * vote screen invalidates this query after a vote/recusal.
 */
export default function ValidatorInboxScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useValidatorInbox();

  const open = useCallback(
    (id: string) => router.push({ pathname: '/(tabs)/(reputation)/validate/[id]', params: { id } }),
    [router],
  );

  const renderBody = () => {
    if (isPending) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={styles.muted}>{t('civic.validate.inbox.loading')}</ThemedText>
        </View>
      );
    }

    if (isError) {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="cloud-alert" size={56} color={colors.textSecondary} />
          <ThemedText style={styles.title}>{t('civic.validate.inbox.error.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>{t('civic.validate.inbox.error.body')}</ThemedText>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.tint }]} onPress={() => refetch()}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!data || data.length === 0) {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="gavel" size={56} color={colors.textSecondary} />
          <ThemedText style={styles.title}>{t('civic.validate.inbox.empty.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>{t('civic.validate.inbox.empty.body')}</ThemedText>
        </View>
      );
    }

    return (
      <View style={styles.list}>
        {data.map((req) => (
          <AccountCard key={req.id}>
            <TouchableOpacity style={styles.row} onPress={() => open(req.id)} accessibilityRole="button">
              <View style={[styles.rowIcon, { backgroundColor: colors.background }]}>
                <MaterialCommunityIcons name="scale-balance" size={20} color={colors.tint} />
              </View>
              <View style={styles.rowText}>
                <ThemedText style={styles.rowTitle}>{prettyActionType(req.actionType)}</ThemedText>
                <ThemedText style={[styles.rowSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                  {t('civic.validate.inbox.requestSubtitle')}
                </ThemedText>
                {req.highValue && (
                  <View style={styles.badgeRow}>
                    <CivicBadge tone="caution" icon="star-circle-outline" label={t('civic.validate.highValue')} />
                  </View>
                )}
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </AccountCard>
        ))}
      </View>
    );
  };

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" style={styles.backBtn}>
              <MaterialCommunityIcons name="chevron-left" size={26} color={colors.text} />
            </TouchableOpacity>
            <ThemedText style={styles.headerTitle}>{t('civic.validate.inbox.title')}</ThemedText>
          </View>
          <ThemedText style={[styles.muted, styles.headerSubtitle]}>{t('civic.validate.inbox.subtitle')}</ThemedText>
        </View>
        {renderBody()}
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  headerTitle: { fontSize: 24, fontWeight: '700' },
  headerSubtitle: { marginTop: 4, marginLeft: 2 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 120 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSubtitle: { fontSize: 13 },
  badgeRow: { flexDirection: 'row', marginTop: 4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, minHeight: 320 },
  muted: { fontSize: 14, opacity: 0.7, lineHeight: 20 },
  centerText: { textAlign: 'center' },
  title: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  retryBtn: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12 },
  retryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
