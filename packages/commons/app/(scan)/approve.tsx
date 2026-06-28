import React, { useCallback, useMemo } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useOxy } from '@oxyhq/services';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import {
  Screen,
  Section,
  Callout,
  CenteredState,
  PrimaryButton,
  SecondaryButton,
} from '@/components/ui';
import { useTranslation } from '@/lib/i18n';
import { useCommonsApproval } from '@/hooks/commons-signin/useCommonsApproval';

/**
 * "Sign in with Oxy" approval screen (Commons / approver side).
 *
 * Reachable two ways, both carrying the public `code`:
 *   - the in-app QR scanner (`/(scan)`) replaces into here after parsing
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
      // Cold deep link with no history — land on the ID home, not the scanner.
      router.replace('/(tabs)/(id)');
    }
  }, [router]);

  const appName = info?.application.name ?? '';
  const scopes = useMemo(() => info?.scopes ?? [], [info?.scopes]);

  // --- Terminal states (approved / denied) ---
  if (state === 'approved' || state === 'denied') {
    const approved = state === 'approved';
    return (
      <Screen>
        <CenteredState
          icon={approved ? 'check-circle-outline' : 'close-circle-outline'}
          iconColor={approved ? colors.success : colors.textSecondary}
          title={approved ? t('signInApproval.approve.approvedTitle') : t('signInApproval.approve.deniedTitle')}
          body={approved ? t('signInApproval.approve.approvedBody') : t('signInApproval.approve.deniedBody')}
          action={
            <View style={styles.action}>
              <PrimaryButton label={t('signInApproval.approve.done')} onPress={handleClose} fullWidth={false} />
            </View>
          }
        />
      </Screen>
    );
  }

  // --- Error state ---
  if (state === 'error') {
    return (
      <Screen>
        <CenteredState
          icon="alert-circle-outline"
          iconColor={colors.error}
          title={t('signInApproval.approve.errorTitle')}
          body={code ? t('signInApproval.approve.errorBody') : t('signInApproval.approve.noCode')}
          action={
            <View style={styles.errorActions}>
              {code ? <SecondaryButton label={t('signInApproval.approve.tryAgain')} onPress={reload} fullWidth={false} /> : null}
              <PrimaryButton label={t('signInApproval.approve.done')} onPress={handleClose} fullWidth={false} />
            </View>
          }
        />
      </Screen>
    );
  }

  // --- Loading ---
  if (state === 'loading' || !info) {
    return (
      <Screen>
        <CenteredState loading body={t('signInApproval.approve.loading')} />
      </Screen>
    );
  }

  const busy = state === 'approving' || state === 'denying';

  // --- Ready: render the server-resolved identity + actions ---
  return (
    <Screen gap={24}>
      <View style={styles.brandBlock}>
        <ThemedText style={[styles.heading, { color: colors.textSecondary }]}>
          {t('signInApproval.approve.heading')}
        </ThemedText>

        {info.application.icon ? (
          <Image source={{ uri: info.application.icon }} style={styles.appIcon} />
        ) : (
          <View style={[styles.appIcon, styles.appIconFallback, { backgroundColor: colors.card }]}>
            <ThemedText style={[styles.appIconLetter, { color: colors.text }]}>
              {appName.charAt(0).toUpperCase() || '?'}
            </ThemedText>
          </View>
        )}
        <ThemedText style={[styles.appName, { color: colors.text }]}>{appName}</ThemedText>

        {info.application.isOfficial ? (
          <View style={[styles.officialBadge, { backgroundColor: colors.primarySubtle }]}>
            <MaterialCommunityIcons name="check-decagram" size={14} color={colors.tint} />
            <ThemedText style={[styles.officialText, { color: colors.tint }]}>
              {t('signInApproval.approve.officialBadge')}
            </ThemedText>
          </View>
        ) : info.application.developerName ? (
          <ThemedText style={[styles.developer, { color: colors.textSecondary }]}>
            {t('signInApproval.approve.developerBy', { developer: info.application.developerName })}
          </ThemedText>
        ) : null}

        <ThemedText style={[styles.prompt, { color: colors.text }]}>
          {t('signInApproval.approve.wantsToSignIn', { app: appName, user: username })}
        </ThemedText>
      </View>

      {info.boundOrigin ? (
        <Section title={t('signInApproval.approve.originLabel')}>
          <ThemedText style={[styles.origin, { color: colors.text }]} numberOfLines={1}>
            {info.boundOrigin}
          </ThemedText>
        </Section>
      ) : null}

      {scopes.length > 0 ? (
        <Section title={t('signInApproval.approve.scopesTitle')}>
          <View style={styles.scopes}>
            {scopes.map((scope) => (
              <View key={scope} style={styles.scopeRow}>
                <MaterialCommunityIcons name="check" size={18} color={colors.success} />
                <ThemedText style={[styles.scopeText, { color: colors.text }]}>{scope}</ThemedText>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {biometricFailed ? (
        <Callout tone="danger" icon="fingerprint">
          {t('signInApproval.approve.biometricFailedBody')}
        </Callout>
      ) : null}

      <View style={styles.actions}>
        <SecondaryButton
          label={state === 'denying' ? t('signInApproval.approve.denying') : t('signInApproval.approve.deny')}
          onPress={deny}
          disabled={busy}
          fullWidth={false}
        />
        <PrimaryButton
          label={state === 'approving' ? t('signInApproval.approve.approving') : t('signInApproval.approve.approve')}
          onPress={approve}
          disabled={busy}
          style={styles.approveFlex}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    marginTop: 4,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  brandBlock: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 16,
  },
  heading: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  appIcon: {
    width: 72,
    height: 72,
    borderRadius: 18,
    borderCurve: 'continuous',
    marginTop: 10,
  },
  appIconFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  appIconLetter: {
    fontSize: 32,
    fontWeight: '700',
  },
  appName: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  officialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  officialText: {
    fontSize: 12,
    fontWeight: '600',
  },
  developer: {
    fontSize: 13,
  },
  prompt: {
    fontSize: 17,
    fontWeight: '500',
    lineHeight: 24,
    textAlign: 'center',
    marginTop: 8,
  },
  origin: {
    fontSize: 14,
    fontWeight: '500',
  },
  scopes: {
    gap: 10,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scopeText: {
    flex: 1,
    fontSize: 15,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  approveFlex: {
    flex: 1,
  },
});
