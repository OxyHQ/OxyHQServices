import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { VerifiableCredentialResponse, CredentialStatus } from '@oxyhq/contracts';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { AccountCard } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { CivicBadge } from '@/components/civic/CivicBadge';
import { useMyCredentials } from '@/hooks/useCredentials';
import { useCivicProfileState } from '@/hooks/useCivicProfileState';
import {
  primaryCredentialType,
  humanizeTypeTag,
  claimEntries,
  getCredentialStatusMeta,
} from '@/lib/civic/credential-display';
import { userIdFromDid } from '@/lib/civic/did';
import { formatDate } from '@/utils/date-utils';
import { useTranslation } from '@/lib/i18n';
import type { MaterialCommunityIconName } from '@/types/icons';

/** Icon per credential status (active = sealed, revoked = struck out, expired = lapsed). */
const STATUS_ICON: Record<CredentialStatus, MaterialCommunityIconName> = {
  active: 'certificate-outline',
  revoked: 'close-octagon-outline',
  expired: 'clock-alert-outline',
};

/** Format an epoch-ms timestamp to a short readable date (or empty). */
function formatMs(ms: number | undefined): string {
  return ms != null ? formatDate(new Date(ms).toISOString()) : '';
}

/** A compact, opaque-but-stable issuer reference for the list row. */
function truncateMiddle(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * "My credentials" — the verifiable credentials the current user holds.
 *
 * Reads the holder list via `listMyCredentials()` (offline-first, like the other
 * civic surfaces). Each credential renders as a card: the specific type (the
 * generic `VerifiableCredential` base is dropped), a preview of the signed
 * claims, a compact issuer reference, the issued date, and a status pill
 * (active / revoked / expired). Tapping a card opens its detail + verify screen.
 * Loading / empty / error states are all handled; pull-to-refresh re-reads.
 */
export default function CredentialsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();

  const query = useMyCredentials();
  const credentials = query.data?.credentials;
  const { isOnline } = useCivicProfileState({ subject: 'remote' });

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(settings)');
  }, [router]);

  const openDetail = useCallback(
    (recordId: string) => {
      router.push({
        pathname: '/(tabs)/(settings)/credentials/[recordId]',
        params: { recordId },
      });
    },
    [router],
  );

  const renderBody = () => {
    if (query.isPending && !credentials) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={styles.muted}>{t('civic.credentials.loading')}</ThemedText>
        </View>
      );
    }

    if (query.isError && !credentials) {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="cloud-alert" size={56} color={colors.textSecondary} />
          <ThemedText style={styles.emptyTitle}>{t('civic.credentials.error.title')}</ThemedText>
          <ThemedText style={[styles.emptyBody, { color: colors.textSecondary }]}>
            {t('civic.credentials.error.body')}
          </ThemedText>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.tint }]}
            onPress={() => query.refetch()}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!credentials || credentials.length === 0) {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="certificate-outline" size={56} color={colors.textSecondary} />
          <ThemedText style={styles.emptyTitle}>{t('civic.credentials.empty.title')}</ThemedText>
          <ThemedText style={[styles.emptyBody, { color: colors.textSecondary }]}>
            {t('civic.credentials.empty.body')}
          </ThemedText>
        </View>
      );
    }

    return (
      <View style={styles.content}>
        <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('civic.credentials.subtitle')}
        </ThemedText>

        {!isOnline && (
          <View style={styles.offlineRow}>
            <CivicBadge tone="neutral" icon="cloud-off-outline" label={t('civic.credentials.offline')} />
          </View>
        )}

        <View style={styles.list}>
          {credentials.map((credential) => (
            <CredentialRow
              key={credential.recordId}
              credential={credential}
              colors={colors}
              t={t}
              onPress={() => openDetail(credential.recordId)}
            />
          ))}
        </View>
      </View>
    );
  };

  return (
    <ScreenContentWrapper refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            style={styles.backBtn}
          >
            <MaterialCommunityIcons name="chevron-left" size={26} color={colors.text} />
          </TouchableOpacity>
          <ThemedText style={styles.topTitle}>{t('civic.credentials.title')}</ThemedText>
        </View>
        {renderBody()}
      </View>
    </ScreenContentWrapper>
  );
}

interface CredentialRowProps {
  credential: VerifiableCredentialResponse;
  colors: ReturnType<typeof useColors>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onPress: () => void;
}

function CredentialRow({ credential, colors, t, onPress }: CredentialRowProps) {
  const primary = primaryCredentialType(credential.types);
  const typeLabel = primary ? humanizeTypeTag(primary) : t('civic.credentials.detail.title');
  const statusMeta = getCredentialStatusMeta(credential.status);
  const preview = claimEntries(credential.claims)[0]?.value ?? '';
  const issuerRef = truncateMiddle(
    userIdFromDid(credential.issuerDid) ?? credential.issuerUserId ?? credential.issuerDid,
  );
  const issuedOn = formatMs(credential.issuedAt);

  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" activeOpacity={0.7}>
      <AccountCard>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <ThemedText style={styles.cardTitle} numberOfLines={1}>
              {typeLabel}
            </ThemedText>
            <CivicBadge
              tone={statusMeta.tone}
              icon={STATUS_ICON[credential.status]}
              label={t(`civic.credentials.status.${statusMeta.labelKey}`)}
            />
          </View>

          {preview.length > 0 && (
            <ThemedText style={[styles.cardPreview, { color: colors.textSecondary }]} numberOfLines={2}>
              {preview}
            </ThemedText>
          )}

          <View style={styles.cardFooter}>
            <ThemedText style={[styles.cardMeta, { color: colors.textSecondary }]} numberOfLines={1}>
              {t('civic.credentials.issuedBy', { issuer: issuerRef })}
            </ThemedText>
            {issuedOn.length > 0 && (
              <ThemedText style={[styles.cardMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                {t('civic.credentials.issuedOn', { date: issuedOn })}
              </ThemedText>
            )}
          </View>
        </View>
      </AccountCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  topTitle: { fontSize: 20, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingBottom: 120 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  offlineRow: { flexDirection: 'row', marginBottom: 16 },
  list: { gap: 12 },
  card: { padding: 14, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  cardPreview: { fontSize: 14, lineHeight: 19 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 2 },
  cardMeta: { fontSize: 12, flexShrink: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
    minHeight: 320,
  },
  muted: { fontSize: 15, opacity: 0.7 },
  emptyTitle: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retryButton: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12 },
  retryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
