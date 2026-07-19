import React, { useCallback, useEffect, useMemo } from 'react';
import { View, Image, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useOxy } from '@oxyhq/services';
import { Dialog, useDialogControl } from '@oxyhq/bloom/dialog';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import {
  Section,
  Callout,
  CenteredState,
  ImportantBanner,
  PrimaryButton,
  SecondaryButton,
} from '@/components/ui';
import { useTranslation } from '@/lib/i18n';
import { useCommonsApproval } from '@/hooks/commons-signin/useCommonsApproval';

/**
 * "Sign in with Oxy" approval surface (Commons / approver side).
 *
 * Reachable two ways, both carrying the public `code`:
 *   - the in-app QR scanner (`/(scan)`) replaces into here after parsing
 *   - a same-device deep link `oxycommons://approve?...` / `commons://approve?...`
 *
 * Rendered as a Bloom bottom sheet (`<Dialog placement="bottom">`) that rises
 * over the underlying context rather than a full-screen takeover — the same
 * Bloom surface `@oxyhq/services`' `OxyAccountDialog` uses. The route is a
 * transparent modal (see `(scan)/_layout.tsx`); the sheet owns its own drag
 * handle + dimmed backdrop.
 *
 * The sheet is driven imperatively (`useDialogControl`) so a backdrop tap or a
 * drag-down fires `onClose` — Bloom's CONTROLLED bottom placement swallows those
 * gestures. Any dismissal (backdrop, drag, or an explicit "Done") is a CANCEL:
 * it navigates away WITHOUT calling deny, matching the previous screen's back
 * behavior. Only the explicit Deny button calls `deny()`.
 *
 * Renders ONLY the server-resolved application identity (anti-phishing) and
 * gates approval behind the device biometric/passcode.
 */
export default function ApproveSignInScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useOxy();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const control = useDialogControl();

  const { state, info, biometricFailed, approve, deny, reload } = useCommonsApproval(
    code,
    t('signInApproval.approve.biometricReason'),
  );

  // Present the sheet on mount. Imperative dialog refs bind during the commit's
  // layout phase, so opening from a mount effect is the sanctioned pattern
  // (mirrors Bloom's own `AutoMountedDialog`).
  useEffect(() => {
    control.open();
  }, [control]);

  // The SINGLE navigation exit, fired by `onClose` once the sheet has finished
  // closing — from a backdrop tap, a drag-down, or an explicit `control.close()`.
  // A dismissal is a CANCEL and never calls deny (parity with the prior back
  // behavior); the RP's authorize code simply expires unclaimed.
  const navigateAway = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // Cold deep link with no history — land on the ID home, not the scanner.
      router.replace('/(tabs)/(id)');
    }
  }, [router]);

  // Run the sheet's close animation, then `navigateAway` via `onClose`.
  const dismiss = useCallback(() => control.close(), [control]);

  const username = user?.username ? `@${user.username}` : t('signInApproval.approve.heading');
  const appName = info?.application.name ?? '';
  const scopes = useMemo(() => info?.scopes ?? [], [info?.scopes]);
  // Anti-phishing: treat anything other than an explicit `true` as unverified
  // (false OR a missing field → warn). The reassuring "official Oxy app"
  // treatment is withheld in this state so it can't lend false legitimacy to a
  // consent-phishing lure that reuses a trusted app's branding.
  const originVerified = info?.originVerified === true;
  const busy = state === 'approving' || state === 'denying';

  let content: React.ReactNode;
  if (state === 'approved' || state === 'denied') {
    // --- Terminal states (approved / denied) ---
    const approved = state === 'approved';
    content = (
      <CenteredState
        icon={approved ? 'check-circle-outline' : 'close-circle-outline'}
        iconColor={approved ? colors.success : colors.textSecondary}
        title={approved ? t('signInApproval.approve.approvedTitle') : t('signInApproval.approve.deniedTitle')}
        body={approved ? t('signInApproval.approve.approvedBody') : t('signInApproval.approve.deniedBody')}
        action={
          <View style={styles.action}>
            <PrimaryButton label={t('signInApproval.approve.done')} onPress={dismiss} fullWidth={false} />
          </View>
        }
      />
    );
  } else if (state === 'error') {
    // --- Error state ---
    content = (
      <CenteredState
        icon="alert-circle-outline"
        iconColor={colors.error}
        title={t('signInApproval.approve.errorTitle')}
        body={code ? t('signInApproval.approve.errorBody') : t('signInApproval.approve.noCode')}
        action={
          <View style={styles.errorActions}>
            {code ? <SecondaryButton label={t('signInApproval.approve.tryAgain')} onPress={reload} fullWidth={false} /> : null}
            <PrimaryButton label={t('signInApproval.approve.done')} onPress={dismiss} fullWidth={false} />
          </View>
        }
      />
    );
  } else if (state === 'loading' || !info) {
    // --- Loading ---
    content = <CenteredState loading body={t('signInApproval.approve.loading')} />;
  } else {
    // --- Ready: render the server-resolved identity + actions ---
    content = (
      <>
        {!originVerified ? (
          <ImportantBanner
            icon="alert"
            title={t('signInApproval.approve.unverifiedTitle')}
            style={styles.warningBanner}
          >
            {t('signInApproval.approve.unverifiedBody')}
          </ImportantBanner>
        ) : null}

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

          {originVerified && info.application.isOfficial ? (
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
      </>
    );
  }

  return (
    <Dialog
      control={control}
      onClose={navigateAway}
      placement="bottom"
      contentPadding={0}
      label={t('signInApproval.approve.heading')}
    >
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {content}
      </ScrollView>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  body: {
    width: '100%',
  },
  bodyContent: {
    flexGrow: 1,
    gap: 24,
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 24,
  },
  action: {
    alignItems: 'center',
    marginTop: 4,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  warningBanner: {
    // The sheet body column already supplies vertical rhythm via `gap`.
    marginBottom: 0,
  },
  brandBlock: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
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
