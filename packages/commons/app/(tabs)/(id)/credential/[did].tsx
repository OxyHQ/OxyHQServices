import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { AccountCard } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useCivicCard } from '@/hooks/useCivicCard';
import { useIssueCredential } from '@/hooks/useIssueCredential';
import { userIdFromDid } from '@/lib/civic/did';
import {
  CREDENTIAL_PRESETS,
  resolveCredentialTypeTag,
  humanizeTypeTag,
  type CredentialPresetId,
} from '@/lib/civic/credential-display';
import { useTranslation } from '@/lib/i18n';

/** Validate the optional expiry input (`YYYY-MM-DD`, must be a future calendar date). */
function parseExpiry(text: string): { iso?: string; valid: boolean; empty: boolean } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { valid: true, empty: true };
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return { valid: false, empty: false };
  const end = new Date(`${trimmed}T23:59:59.999Z`);
  if (Number.isNaN(end.getTime())) return { valid: false, empty: false };
  // Reject overflowed calendar dates (e.g. 2026-02-30 normalizes to March).
  if (end.toISOString().slice(0, 10) !== trimmed) return { valid: false, empty: false };
  if (end.getTime() <= Date.now()) return { valid: false, empty: false };
  return { iso: end.toISOString(), valid: true, empty: false };
}

/**
 * Issue a credential (Fase 4) — the issuer signs a verifiable claim ABOUT the
 * scanned holder with their own on-device key.
 *
 * Reuses the scanned subject's signed card (`useCivicCard`) for their name +
 * avatar, then collects a credential type (a small preset list + a free-form
 * custom label), a free-text claim statement, and an optional expiry. The issue
 * is gated behind the device biometric (it signs a `credential` record on the
 * issuer's chain); server rejections (self-credential, bad params, holder not
 * found) map to friendly copy via `useIssueCredential`.
 *
 * NATIVE-ONLY (the credential signs with the on-device key).
 */
export default function IssueCredentialScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { did } = useLocalSearchParams<{ did: string }>();

  const userId = useMemo(() => (did ? userIdFromDid(did) : null), [did]);
  const cardQuery = useCivicCard(userId);
  const card = cardQuery.data?.card;
  const subjectName = card?.name ?? '';
  const displayName = subjectName || t('civic.credentials.issue.unknownPerson');

  const [presetId, setPresetId] = useState<CredentialPresetId>('employment');
  const [customLabel, setCustomLabel] = useState('');
  const [statement, setStatement] = useState('');
  const [expiryText, setExpiryText] = useState('');

  const { state, biometricFailed, errorCode, issue } = useIssueCredential(
    did ?? null,
    t('civic.credentials.issue.biometricReason'),
  );

  const handleClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(id)');
  }, [router]);

  const typeTag = useMemo(
    () => resolveCredentialTypeTag(presetId, customLabel),
    [presetId, customLabel],
  );
  const expiry = useMemo(() => parseExpiry(expiryText), [expiryText]);
  const trimmedStatement = statement.trim();

  const busy = state === 'issuing';
  const canSubmit =
    !busy && typeTag !== null && trimmedStatement.length > 0 && expiry.valid;

  const handleIssue = useCallback(() => {
    if (!typeTag || trimmedStatement.length === 0 || !expiry.valid) return;
    void issue({
      types: [typeTag],
      claims: { statement: trimmedStatement },
      expiresAt: expiry.empty ? undefined : expiry.iso,
    });
  }, [issue, typeTag, trimmedStatement, expiry]);

  const renderBody = () => {
    if (!userId || !did) {
      return (
        <EmptyState
          icon="account-alert-outline"
          title={t('civic.credentials.issue.invalidTitle')}
          body={t('civic.credentials.issue.invalidBody')}
          colors={colors}
        />
      );
    }

    if (state === 'done') {
      const issuedTypeLabel = typeTag ? humanizeTypeTag(typeTag) : '';
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="certificate" size={64} color={colors.success} />
          <ThemedText style={styles.resultTitle}>{t('civic.credentials.issue.done.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>
            {t('civic.credentials.issue.done.body', { type: issuedTypeLabel, name: displayName })}
          </ThemedText>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.tint }]} onPress={handleClose}>
            <Text style={styles.primaryText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (state === 'error') {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="alert-circle-outline" size={56} color={colors.error} />
          <ThemedText style={styles.resultTitle}>{t('civic.credentials.issue.error.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>
            {t(`civic.credentials.issue.error.${errorCode ?? 'generic'}`)}
          </ThemedText>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.tint }]} onPress={handleClose}>
            <Text style={styles.primaryText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (cardQuery.isPending && !card) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={styles.muted}>{t('civic.credentials.issue.loading')}</ThemedText>
        </View>
      );
    }

    return (
      <View style={styles.content}>
        {/* Subject identity */}
        <View style={styles.identityRow}>
          {card?.avatarUrl ? (
            <Image source={{ uri: card.avatarUrl }} style={styles.avatar} resizeMode="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
              <Text style={[styles.avatarInitial, { color: colors.textSecondary }]}>
                {displayName.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <View style={styles.identityText}>
            <ThemedText style={styles.name} numberOfLines={2}>
              {displayName}
            </ThemedText>
            {card?.username && (
              <ThemedText style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
                @{card.username}
              </ThemedText>
            )}
          </View>
        </View>

        <ThemedText style={[styles.intro, { color: colors.text }]}>
          {t('civic.credentials.issue.intro', { name: displayName })}
        </ThemedText>

        {/* Credential type */}
        <Section title={t('civic.credentials.issue.typeTitle')}>
          <ThemedText style={styles.sectionSubtitle}>{t('civic.credentials.issue.typeHint')}</ThemedText>
          <View style={styles.presetRow}>
            {CREDENTIAL_PRESETS.map((preset) => {
              const selected = preset.id === presetId;
              return (
                <TouchableOpacity
                  key={preset.id}
                  onPress={() => setPresetId(preset.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[
                    styles.presetChip,
                    { borderColor: selected ? colors.tint : colors.border },
                    selected && { backgroundColor: `${colors.tint}1A` },
                  ]}
                >
                  <Text style={[styles.presetText, { color: selected ? colors.tint : colors.text }]}>
                    {t(`civic.credentials.issue.preset.${preset.id}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {presetId === 'custom' && (
            <AccountCard>
              <View style={styles.fieldCard}>
                <ThemedText style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  {t('civic.credentials.issue.customLabel')}
                </ThemedText>
                <TextInput
                  value={customLabel}
                  onChangeText={setCustomLabel}
                  editable={!busy}
                  placeholder={t('civic.credentials.issue.customPlaceholder')}
                  placeholderTextColor={colors.textSecondary}
                  accessibilityLabel={t('civic.credentials.issue.customLabel')}
                  style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                />
              </View>
            </AccountCard>
          )}
        </Section>

        {/* Claim statement */}
        <Section title={t('civic.credentials.issue.statementTitle')}>
          <ThemedText style={styles.sectionSubtitle}>{t('civic.credentials.issue.statementHint')}</ThemedText>
          <AccountCard>
            <View style={styles.fieldCard}>
              <TextInput
                value={statement}
                onChangeText={setStatement}
                editable={!busy}
                multiline
                numberOfLines={4}
                placeholder={t('civic.credentials.issue.statementPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel={t('civic.credentials.issue.statementTitle')}
                style={[styles.input, styles.multiline, { color: colors.text, borderColor: colors.border }]}
              />
            </View>
          </AccountCard>
        </Section>

        {/* Optional expiry */}
        <Section title={t('civic.credentials.issue.expiryTitle')}>
          <ThemedText style={styles.sectionSubtitle}>{t('civic.credentials.issue.expiryHint')}</ThemedText>
          <AccountCard>
            <View style={styles.fieldCard}>
              <TextInput
                value={expiryText}
                onChangeText={setExpiryText}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                placeholder={t('civic.credentials.issue.expiryPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel={t('civic.credentials.issue.expiryTitle')}
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
            </View>
          </AccountCard>
          {!expiry.valid && (
            <ThemedText style={[styles.fieldError, { color: colors.warning }]}>
              {t('civic.credentials.issue.expiryInvalid')}
            </ThemedText>
          )}
        </Section>

        {/* Attribution warning */}
        <View style={[styles.warningCard, { backgroundColor: `${colors.identityIconPublicKey}14`, borderColor: `${colors.identityIconPublicKey}44` }]}>
          <MaterialCommunityIcons name="draw-pen" size={20} color={colors.identityIconPublicKey} />
          <ThemedText style={[styles.warningText, { color: colors.text }]}>
            {t('civic.credentials.issue.attribution', { name: displayName })}
          </ThemedText>
        </View>

        {biometricFailed && (
          <ThemedText style={[styles.biometricWarn, { color: colors.warning }]}>
            {t('civic.credentials.issue.biometricFailed')}
          </ThemedText>
        )}

        <TouchableOpacity
          style={[styles.issueBtn, { backgroundColor: colors.tint }, !canSubmit && styles.btnDisabled]}
          onPress={handleIssue}
          disabled={!canSubmit}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="fingerprint" size={20} color="#fff" />
          <Text style={styles.issueText}>{t('civic.credentials.issue.cta')}</Text>
        </TouchableOpacity>

        {busy && (
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.tint} />
            <ThemedText style={styles.muted}>{t('civic.credentials.issue.submitting')}</ThemedText>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleClose} accessibilityRole="button" style={styles.backBtn}>
            <MaterialCommunityIcons name="chevron-left" size={26} color={colors.text} />
          </TouchableOpacity>
          <ThemedText style={styles.topTitle}>{t('civic.credentials.issue.title')}</ThemedText>
        </View>
        {renderBody()}
      </View>
    </ScreenContentWrapper>
  );
}

interface EmptyStateProps {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  body: string;
  colors: ReturnType<typeof useColors>;
}

function EmptyState({ icon, title, body, colors }: EmptyStateProps) {
  return (
    <View style={styles.centered}>
      <MaterialCommunityIcons name={icon} size={56} color={colors.textSecondary} />
      <ThemedText style={styles.resultTitle}>{title}</ThemedText>
      <ThemedText style={[styles.muted, styles.centerText]}>{body}</ThemedText>
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
  identityRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 24, fontWeight: '600' },
  identityText: { flex: 1, marginLeft: 14 },
  name: { fontSize: 20, fontWeight: '700' },
  username: { fontSize: 14, marginTop: 2 },
  intro: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  sectionSubtitle: { fontSize: 14, opacity: 0.7, marginBottom: 12 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  presetText: { fontSize: 14, fontWeight: '600' },
  fieldCard: { padding: 12, gap: 8 },
  fieldLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  fieldError: { fontSize: 13, marginTop: 8 },
  warningCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  warningText: { flex: 1, fontSize: 13, lineHeight: 19 },
  biometricWarn: { fontSize: 13, marginTop: 12 },
  issueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 12,
    marginTop: 20,
  },
  btnDisabled: { opacity: 0.5 },
  issueText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  busyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 14 },
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
