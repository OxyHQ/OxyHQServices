import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useOxy } from '@oxyhq/services';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import { useCommonsApproval } from '@/hooks/commons-signin/useCommonsApproval';

/**
 * "Sign in with Oxy" approval screen (Commons / approver side).
 *
 * Reachable two ways, both carrying the public `code`:
 *   - the in-app QR scanner (`/(vault)/scan`) pushes here after parsing
 *   - a same-device deep link `oxycommons://approve?...` / `commons://approve?...`
 *
 * Renders ONLY the server-resolved application identity (anti-phishing) and
 * gates approval behind the device biometric/passcode. All copy is Oxy-branded.
 */
export default function ApproveSignInScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useOxy();
  const { code } = useLocalSearchParams<{ code?: string }>();

  const { state, info, biometricFailed, approve, deny, reload } = useCommonsApproval(
    code,
    t('signInApproval.approve.biometricReason'),
  );

  const username = user?.username ? `@${user.username}` : t('signInApproval.approve.heading');

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/(scan)');
    }
  }, [router]);

  const appName = info?.application.name ?? '';

  const scopes = useMemo(() => info?.scopes ?? [], [info?.scopes]);

  // --- Terminal states (approved / denied) ---
  if (state === 'approved' || state === 'denied') {
    const approved = state === 'approved';
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons
          name={approved ? 'check-circle-outline' : 'close-circle-outline'}
          size={64}
          color={approved ? colors.success : colors.textSecondary}
        />
        <Text style={[styles.title, { color: colors.text }]}>
          {approved ? t('signInApproval.approve.approvedTitle') : t('signInApproval.approve.deniedTitle')}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {approved ? t('signInApproval.approve.approvedBody') : t('signInApproval.approve.deniedBody')}
        </Text>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.tint }]}
          onPress={handleClose}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{t('signInApproval.approve.done')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Error state ---
  if (state === 'error') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name="alert-circle-outline" size={64} color={colors.error} />
        <Text style={[styles.title, { color: colors.text }]}>
          {t('signInApproval.approve.errorTitle')}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {code ? t('signInApproval.approve.errorBody') : t('signInApproval.approve.noCode')}
        </Text>
        <View style={styles.errorActions}>
          {code ? (
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: colors.border }]}
              onPress={reload}
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                {t('signInApproval.approve.tryAgain')}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.tint }]}
            onPress={handleClose}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>{t('signInApproval.approve.done')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- Loading ---
  if (state === 'loading' || !info) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {t('signInApproval.approve.loading')}
        </Text>
      </View>
    );
  }

  const busy = state === 'approving' || state === 'denying';

  // --- Ready: render the server-resolved identity + actions ---
  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.heading, { color: colors.textSecondary }]}>
        {t('signInApproval.approve.heading')}
      </Text>

      <View style={styles.appHeader}>
        {info.application.icon ? (
          <Image source={{ uri: info.application.icon }} style={styles.appIcon} />
        ) : (
          <View style={[styles.appIcon, styles.appIconFallback, { backgroundColor: colors.card }]}>
            <Text style={[styles.appIconLetter, { color: colors.text }]}>
              {appName.charAt(0).toUpperCase() || '?'}
            </Text>
          </View>
        )}
        <Text style={[styles.appName, { color: colors.text }]}>{appName}</Text>

        {info.application.isOfficial ? (
          <View style={[styles.badge, { backgroundColor: colors.card }]}>
            <MaterialCommunityIcons name="check-decagram" size={14} color={colors.tint} />
            <Text style={[styles.badgeText, { color: colors.tint }]}>
              {t('signInApproval.approve.officialBadge')}
            </Text>
          </View>
        ) : info.application.developerName ? (
          <Text style={[styles.developer, { color: colors.textSecondary }]}>
            {t('signInApproval.approve.developerBy', { developer: info.application.developerName })}
          </Text>
        ) : null}
      </View>

      <Text style={[styles.prompt, { color: colors.text }]}>
        {t('signInApproval.approve.wantsToSignIn', { app: appName, user: username })}
      </Text>

      {info.boundOrigin ? (
        <View style={[styles.metaRow, { borderColor: colors.border }]}>
          <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
            {t('signInApproval.approve.originLabel')}
          </Text>
          <Text style={[styles.metaValue, { color: colors.text }]} numberOfLines={1}>
            {info.boundOrigin}
          </Text>
        </View>
      ) : null}

      {scopes.length > 0 ? (
        <View style={styles.scopes}>
          <Text style={[styles.scopesTitle, { color: colors.textSecondary }]}>
            {t('signInApproval.approve.scopesTitle')}
          </Text>
          {scopes.map((scope) => (
            <View key={scope} style={styles.scopeRow}>
              <MaterialCommunityIcons name="circle-small" size={20} color={colors.textSecondary} />
              <Text style={[styles.scopeText, { color: colors.text }]}>{scope}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {biometricFailed ? (
        <View style={[styles.biometricBanner, { backgroundColor: colors.card }]}>
          <MaterialCommunityIcons name="fingerprint" size={18} color={colors.error} />
          <Text style={[styles.biometricText, { color: colors.error }]}>
            {t('signInApproval.approve.biometricFailedBody')}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: colors.border }]}
          onPress={deny}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
            {state === 'denying' ? t('signInApproval.approve.denying') : t('signInApproval.approve.deny')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, styles.actionFlex, { backgroundColor: colors.tint }]}
          onPress={approve}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>
            {state === 'approving' ? t('signInApproval.approve.approving') : t('signInApproval.approve.approve')}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingTop: 48,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  heading: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  appHeader: {
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
    marginBottom: 24,
  },
  appIcon: {
    width: 72,
    height: 72,
    borderRadius: 18,
  },
  appIconFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  appIconLetter: {
    fontSize: 32,
    fontWeight: '700',
  },
  appName: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  developer: {
    fontSize: 13,
  },
  prompt: {
    fontSize: 17,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  metaRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  metaLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  scopes: {
    marginBottom: 24,
  },
  scopesTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scopeText: {
    fontSize: 14,
    flex: 1,
  },
  biometricBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  biometricText: {
    flex: 1,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionFlex: {
    flex: 1,
  },
  primaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
