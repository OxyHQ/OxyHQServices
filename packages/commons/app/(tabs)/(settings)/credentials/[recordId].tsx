import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useOxy } from '@oxyhq/services';
import type { VerifiableCredentialResponse } from '@oxyhq/contracts';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { AccountCard } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { CivicBadge } from '@/components/civic/CivicBadge';
import { useMyCredentials } from '@/hooks/useCredentials';
import { useVerifyCredential } from '@/hooks/useVerifyCredential';
import { useRevokeCredential } from '@/hooks/useRevokeCredential';
import { useCivicCard } from '@/hooks/useCivicCard';
import { userIdFromDid } from '@/lib/civic/did';
import {
  primaryCredentialType,
  humanizeTypeTag,
  claimEntries,
  getCredentialStatusMeta,
  canRevokeCredential,
} from '@/lib/civic/credential-display';
import { formatDate } from '@/utils/date-utils';
import { useTranslation } from '@/lib/i18n';

/** Format an epoch-ms timestamp to a short readable date (or empty). */
function formatMs(ms: number | undefined): string {
  return ms != null ? formatDate(new Date(ms).toISOString()) : '';
}

/**
 * Credential detail + verify (+ revoke for the issuer).
 *
 * The credential body (type, claims, issuer, dates, status) is read from the
 * cached "my credentials" list and kept fresh by the verify / revoke results.
 * "Verify" calls `verifyCredential(recordId)` server-side and surfaces an
 * explicit VALID / UNTRUSTED verdict with a friendly reason. When the current
 * user is the ORIGINAL issuer of an active credential, a biometric-gated
 * "Revoke" action is offered — the server is authoritative on who may revoke.
 *
 * NATIVE-ONLY for the revoke path (it acts on a record the issuer signed).
 */
export default function CredentialDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { recordId } = useLocalSearchParams<{ recordId: string }>();
  const { user } = useOxy();
  const myId = user?.id ?? null;

  const listQuery = useMyCredentials();
  const fromList = useMemo<VerifiableCredentialResponse | null>(
    () => listQuery.data?.credentials.find((c) => c.recordId === recordId) ?? null,
    [listQuery.data, recordId],
  );

  const verify = useVerifyCredential(recordId ?? null);
  const revoke = useRevokeCredential(t('civic.credentials.revoke.biometricReason'));

  // The freshest known credential: a revoke result wins, then a verify result,
  // then the cached list row.
  const credential = revoke.result?.credential ?? verify.result?.credential ?? fromList;

  // Resolve the issuer's public card for a human name where possible.
  const issuerUserId = credential ? userIdFromDid(credential.issuerDid) : null;
  const issuerCard = useCivicCard(issuerUserId);
  const issuerName = issuerCard.data?.card?.name;

  const canRevoke = credential ? canRevokeCredential(credential, myId) : false;

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(settings)/credentials');
  }, [router]);

  const handleRevoke = useCallback(() => {
    if (credential) void revoke.revoke(credential);
  }, [revoke, credential]);

  const renderBody = () => {
    // Resolving the credential from the list for the first time.
    if (!credential && listQuery.isPending) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={styles.muted}>{t('civic.credentials.loading')}</ThemedText>
        </View>
      );
    }

    if (!credential) {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="file-document-alert-outline" size={56} color={colors.textSecondary} />
          <ThemedText style={styles.resultTitle}>{t('civic.credentials.detail.notFoundTitle')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>
            {t('civic.credentials.detail.notFoundBody')}
          </ThemedText>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.tint }]} onPress={handleBack}>
            <Text style={styles.primaryText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const primary = primaryCredentialType(credential.types);
    const typeLabel = primary ? humanizeTypeTag(primary) : t('civic.credentials.detail.title');
    const statusMeta = getCredentialStatusMeta(credential.status);
    const claims = claimEntries(credential.claims);
    const issuerDisplay = issuerName ?? credential.issuerUserId ?? credential.issuerDid;

    const issuedOn = formatMs(credential.issuedAt);
    const expiresOn = formatMs(credential.expiresAt);
    const revokedOn = formatMs(credential.revokedAt);

    return (
      <View style={styles.content}>
        {/* Type + status hero */}
        <View style={styles.heroRow}>
          <ThemedText style={styles.heroType} numberOfLines={2}>
            {typeLabel}
          </ThemedText>
          <CivicBadge
            tone={statusMeta.tone}
            icon="certificate-outline"
            label={t(`civic.credentials.status.${statusMeta.labelKey}`)}
          />
        </View>

        {/* Verify verdict */}
        {verify.state === 'valid' && (
          <View style={styles.verdictBlock}>
            <CivicBadge emphasis tone="positive" icon="check-decagram" label={t('civic.credentials.verify.validTitle')} />
            <ThemedText style={[styles.verdictDesc, { color: colors.textSecondary }]}>
              {t('civic.credentials.verify.validBody')}
            </ThemedText>
          </View>
        )}
        {verify.state === 'invalid' && (
          <View style={styles.verdictBlock}>
            <CivicBadge emphasis tone="danger" icon="alert-decagram" label={t('civic.credentials.verify.invalidTitle')} />
            <ThemedText style={[styles.verdictDesc, { color: colors.textSecondary }]}>
              {t(`civic.credentials.verify.reason.${verify.reasonCode ?? 'generic'}`)}
            </ThemedText>
          </View>
        )}
        {verify.state === 'error' && (
          <View style={styles.verdictBlock}>
            <CivicBadge emphasis tone="caution" icon="cloud-alert" label={t('civic.credentials.verify.errorTitle')} />
            <ThemedText style={[styles.verdictDesc, { color: colors.textSecondary }]}>
              {t('civic.credentials.verify.errorBody')}
            </ThemedText>
          </View>
        )}

        {/* Verify action */}
        <TouchableOpacity
          style={[styles.verifyBtn, { borderColor: colors.tint }, verify.state === 'verifying' && styles.btnDisabled]}
          onPress={() => void verify.verify()}
          disabled={verify.state === 'verifying'}
          accessibilityRole="button"
        >
          {verify.state === 'verifying' ? (
            <ActivityIndicator color={colors.tint} />
          ) : (
            <MaterialCommunityIcons name="shield-search" size={18} color={colors.tint} />
          )}
          <Text style={[styles.verifyText, { color: colors.tint }]}>
            {verify.state === 'verifying' ? t('civic.credentials.verify.verifying') : t('civic.credentials.verify.cta')}
          </Text>
        </TouchableOpacity>

        {/* Claims */}
        <Section title={t('civic.credentials.detail.claimsTitle')}>
          <AccountCard>
            <View style={styles.listCard}>
              {claims.length === 0 ? (
                <ThemedText style={[styles.noClaims, { color: colors.textSecondary }]}>
                  {t('civic.credentials.detail.noClaims')}
                </ThemedText>
              ) : (
                claims.map((entry) => (
                  <View key={entry.key} style={styles.claimRow}>
                    <ThemedText style={[styles.claimLabel, { color: colors.textSecondary }]}>
                      {entry.label}
                    </ThemedText>
                    <ThemedText style={styles.claimValue}>{entry.value}</ThemedText>
                  </View>
                ))
              )}
            </View>
          </AccountCard>
        </Section>

        {/* Issuer */}
        <Section title={t('civic.credentials.detail.issuerTitle')}>
          <AccountCard>
            <View style={styles.issuerRow}>
              <MaterialCommunityIcons name="account-badge-outline" size={20} color={colors.identityIconPublicKey} />
              <View style={styles.issuerText}>
                <ThemedText style={styles.issuerName} numberOfLines={1}>
                  {issuerDisplay || t('civic.credentials.unknownIssuer')}
                </ThemedText>
                <ThemedText style={[styles.issuerDid, { color: colors.textSecondary }]} selectable numberOfLines={1}>
                  {credential.issuerDid}
                </ThemedText>
              </View>
            </View>
          </AccountCard>
        </Section>

        {/* Validity */}
        <Section title={t('civic.credentials.detail.datesTitle')}>
          <AccountCard>
            <View style={styles.listCard}>
              {issuedOn.length > 0 && (
                <DateRow colors={colors} icon="calendar-check" label={t('civic.credentials.issuedOn', { date: issuedOn })} />
              )}
              {credential.status === 'revoked' && revokedOn.length > 0 ? (
                <DateRow colors={colors} icon="close-octagon-outline" tone={colors.error} label={t('civic.credentials.revokedOn', { date: revokedOn })} />
              ) : expiresOn.length > 0 ? (
                <DateRow
                  colors={colors}
                  icon="calendar-remove"
                  tone={credential.status === 'expired' ? colors.warning : undefined}
                  label={t(
                    credential.status === 'expired' ? 'civic.credentials.expiredOn' : 'civic.credentials.expiresOn',
                    { date: expiresOn },
                  )}
                />
              ) : (
                <DateRow colors={colors} icon="infinity" label={t('civic.credentials.noExpiry')} />
              )}
            </View>
          </AccountCard>
        </Section>

        {/* Record id */}
        <Section title={t('civic.credentials.detail.recordLabel')}>
          <ThemedText style={[styles.recordValue, { color: colors.textSecondary }]} selectable numberOfLines={2}>
            {credential.recordId}
          </ThemedText>
        </Section>

        {/* Revoke — issuer-only, active-only */}
        {canRevoke && revoke.state !== 'done' && (
          <View style={styles.revokeBlock}>
            <View style={[styles.warningCard, { backgroundColor: `${colors.error}12`, borderColor: `${colors.error}44` }]}>
              <MaterialCommunityIcons name="alert-outline" size={20} color={colors.error} />
              <ThemedText style={[styles.warningText, { color: colors.text }]}>
                {t('civic.credentials.revoke.confirmBody')}
              </ThemedText>
            </View>
            {revoke.biometricFailed && (
              <ThemedText style={[styles.biometricWarn, { color: colors.warning }]}>
                {t('civic.credentials.revoke.biometricFailed')}
              </ThemedText>
            )}
            {revoke.state === 'error' && (
              <ThemedText style={[styles.biometricWarn, { color: colors.error }]}>
                {t(`civic.credentials.revoke.error.${revoke.errorCode ?? 'generic'}`)}
              </ThemedText>
            )}
            <TouchableOpacity
              style={[styles.revokeBtn, { backgroundColor: colors.error }, revoke.state === 'revoking' && styles.btnDisabled]}
              onPress={handleRevoke}
              disabled={revoke.state === 'revoking'}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="fingerprint" size={20} color="#fff" />
              <Text style={styles.revokeText}>{t('civic.credentials.revoke.cta')}</Text>
            </TouchableOpacity>
            {revoke.state === 'revoking' && (
              <View style={styles.busyRow}>
                <ActivityIndicator color={colors.error} />
                <ThemedText style={styles.muted}>{t('civic.credentials.revoke.submitting')}</ThemedText>
              </View>
            )}
          </View>
        )}

        {revoke.state === 'done' && (
          <View style={styles.revokeDone}>
            <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.success} />
            <ThemedText style={[styles.revokeDoneText, { color: colors.textSecondary }]}>
              {t('civic.credentials.revoke.doneBody')}
            </ThemedText>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScreenContentWrapper>
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
          <ThemedText style={styles.topTitle}>{t('civic.credentials.detail.title')}</ThemedText>
        </View>
        {renderBody()}
      </View>
    </ScreenContentWrapper>
  );
}

interface DateRowProps {
  colors: ReturnType<typeof useColors>;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  tone?: string;
}

function DateRow({ colors, icon, label, tone }: DateRowProps) {
  return (
    <View style={styles.dateRow}>
      <MaterialCommunityIcons name={icon} size={18} color={tone ?? colors.textSecondary} />
      <ThemedText style={[styles.dateText, tone ? { color: tone } : null]}>{label}</ThemedText>
    </View>
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
  content: { padding: 16, paddingBottom: 120 },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  heroType: { flex: 1, fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  verdictBlock: { gap: 8, marginBottom: 16 },
  verdictDesc: { fontSize: 13, lineHeight: 19 },
  verifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  verifyText: { fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
  listCard: { padding: 12, gap: 12 },
  claimRow: { gap: 2 },
  claimLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  claimValue: { fontSize: 15, lineHeight: 21 },
  noClaims: { fontSize: 14, lineHeight: 20 },
  issuerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  issuerText: { flex: 1, gap: 2 },
  issuerName: { fontSize: 15, fontWeight: '600' },
  issuerDid: { fontSize: 12 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateText: { fontSize: 14 },
  recordValue: { fontSize: 13 },
  revokeBlock: { marginTop: 8, gap: 12 },
  warningCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  warningText: { flex: 1, fontSize: 13, lineHeight: 19 },
  biometricWarn: { fontSize: 13 },
  revokeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 12,
  },
  revokeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  busyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  revokeDone: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  revokeDoneText: { flex: 1, fontSize: 14, lineHeight: 20 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 14,
    minHeight: 360,
  },
  muted: { fontSize: 14, opacity: 0.7, lineHeight: 20 },
  centerText: { textAlign: 'center' },
  resultTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  primaryBtn: { marginTop: 4, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
