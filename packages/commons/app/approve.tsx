import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Image,
  ScrollView,
  Pressable,
  StyleSheet,
  Linking,
  Platform,
  BackHandler,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { LogoIcon } from '@oxyhq/services';
import { Dialog, useDialogControl } from '@oxyhq/bloom/dialog';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import {
  Callout,
  CenteredState,
  ImportantBanner,
  PrimaryButton,
  SecondaryButton,
} from '@/components/ui';
import { useTranslation } from '@/lib/i18n';
import { useCommonsApproval } from '@/hooks/commons-signin/useCommonsApproval';
import { resolveApprovedAction } from '@/lib/commons-signin/approval-return';
import { ErrorFallback } from '@/components/error-fallback';

/** How long the success confirmation lingers before we return / close. */
const APPROVED_RETURN_DELAY_MS = 1000;

/**
 * "Sign in with Oxy" approval surface (Commons / approver side).
 *
 * This is a ROOT-level route (`app/approve.tsx`, URL `/approve`), NOT part of the
 * `(scan)` group. It is deliberately outside `(scan)` because that group is a
 * `fullScreenModal` — an opaque card would sit behind the sheet, making it look
 * like a dedicated screen. As a root `transparentModal` (registered in
 * `app/_layout.tsx`) the sheet instead rises over the real underlying context
 * (the `(tabs)` anchor from `unstable_settings`), which is what the user sees.
 *
 * Reachable two ways, both carrying the public `code`:
 *   - the in-app QR scanner (`/(scan)`) replaces into `/approve` (threads `source=scanner`)
 *   - a same-device deep link `oxycommons://approve?...` / `commons://approve?...`
 *
 * Rendered as a Bloom bottom sheet (`<Dialog placement="bottom">`) — the same
 * Bloom surface `@oxyhq/services`' `OxyAccountDialog` uses — restyled after the
 * connect-app pairing pattern: a dark Oxy-brand hero with the [requesting app] ↔
 * [Oxy] logo lockup, a centered title/description, the Approve CTA (Deny below),
 * and a footer scope summary + privacy/terms links. The sheet owns its own drag
 * behavior + dimmed backdrop over the transparent route.
 *
 * Driven imperatively (`useDialogControl`) so a backdrop tap, a drag-down, or an
 * explicit close all fire `onClose` — Bloom's CONTROLLED bottom placement
 * swallows those gestures. Any dismissal is a CANCEL: it never calls deny (parity
 * with the previous screen's back behavior). Only the explicit Deny button calls
 * `deny()`.
 *
 * On a SUCCESSFUL approve the success state lingers ~1s, then Commons either
 * returns the user to the caller (same-device deep-link handoff on Android, via
 * backgrounding) or simply closes the sheet (scanner path, and iOS — no
 * programmatic backgrounding exists). See `resolveApprovedAction`.
 *
 * SECURITY: only the server-resolved `info.application` identity is rendered
 * (anti-phishing — never the QR's self-asserted strings); the requesting app's
 * logo comes ONLY from that record; `originVerified === true` is required for the
 * reassuring "official app" treatment, and anything else raises a loud warning;
 * approval stays gated behind the device biometric/passcode.
 */
export default function ApproveSignInScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { code, source } = useLocalSearchParams<{ code?: string; source?: string }>();
  const control = useDialogControl();

  const { state, info, biometricFailed, errorMessage, approve, deny, reload } = useCommonsApproval(
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
  // closing. A dismissal is a CANCEL and never calls deny.
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

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch((error: unknown) => {
      console.warn('[approve] failed to open external link', error);
    });
  }, []);

  // After a successful approve: briefly show the confirmation, then return to
  // the caller (deep-link handoff on Android) or close the sheet (scanner / iOS).
  useEffect(() => {
    if (state !== 'approved') return;
    const timer = setTimeout(() => {
      if (resolveApprovedAction(source, Platform.OS) === 'return-to-caller') {
        // Reset the underlying route first so a later re-open lands on the ID
        // home, then background Commons so the OS returns to the caller.
        navigateAway();
        BackHandler.exitApp();
      } else {
        dismiss();
      }
    }, APPROVED_RETURN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, source, navigateAway, dismiss]);

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
    // --- Terminal states. Approved auto-advances (return/close); denied waits. ---
    const approved = state === 'approved';
    content = (
      <View className="px-5 py-2">
        <CenteredState
          icon={approved ? 'check-circle-outline' : 'close-circle-outline'}
          iconColor={approved ? colors.success : colors.textSecondary}
          title={approved ? t('signInApproval.approve.approvedTitle') : t('signInApproval.approve.deniedTitle')}
          body={approved ? t('signInApproval.approve.approvedBody') : t('signInApproval.approve.deniedBody')}
          action={
            approved ? undefined : (
              <View className="mt-1 items-center">
                <PrimaryButton label={t('signInApproval.approve.done')} onPress={dismiss} fullWidth={false} />
              </View>
            )
          }
        />
      </View>
    );
  } else if (state === 'error') {
    // --- Error state ---
    content = (
      <View className="px-5 py-2">
        <CenteredState
          icon="alert-circle-outline"
          iconColor={colors.error}
          title={t('signInApproval.approve.errorTitle')}
          body={
            code
              ? (errorMessage ?? t('signInApproval.approve.errorBody'))
              : t('signInApproval.approve.noCode')
          }
          action={
            <View className="mt-1 flex-row gap-3">
              {code ? <SecondaryButton label={t('signInApproval.approve.tryAgain')} onPress={reload} fullWidth={false} /> : null}
              <PrimaryButton label={t('signInApproval.approve.done')} onPress={dismiss} fullWidth={false} />
            </View>
          }
        />
      </View>
    );
  } else if (state === 'loading' || !info?.application) {
    // --- Loading ---
    content = (
      <View className="px-5 py-2">
        <CenteredState loading body={t('signInApproval.approve.loading')} />
      </View>
    );
  } else {
    // --- Ready: the server-resolved identity + actions ---
    const description = info.application.description?.trim()
      ? info.application.description
      : t('signInApproval.approve.description', { app: appName });
    const hasLegalLinks = Boolean(info.application.privacyPolicyUrl || info.application.termsUrl);

    content = (
      <View>
        {/* HERO — dark Oxy-brand block with the app ↔ Oxy pairing lockup. */}
        <View className="overflow-hidden rounded-t-[28px]" style={{ backgroundColor: colors.primary }}>
          <LinearGradient
            colors={['rgba(0,0,0,0.04)', 'rgba(0,0,0,0.55)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Pressable
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            className="absolute right-3 top-3 h-10 w-10 items-center justify-center rounded-full"
            style={styles.closeButton}
          >
            <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
          </Pressable>

          <View className="items-center px-6 pb-9 pt-14">
            <View className="flex-row items-center gap-4">
              {/* Requesting app — logo from the SERVER-RESOLVED record only. */}
              <View className="h-14 w-14 items-center justify-center rounded-2xl bg-white" style={styles.logoCard}>
                {info.application.icon ? (
                  <Image source={{ uri: info.application.icon }} className="h-9 w-9 rounded-lg" />
                ) : (
                  <ThemedText style={[styles.logoInitial, { color: colors.primary }]}>
                    {appName.charAt(0).toUpperCase() || '?'}
                  </ThemedText>
                )}
              </View>
              <View className="h-9 w-px" style={styles.pairingDivider} />
              {/* Oxy */}
              <View className="h-14 w-14 items-center justify-center rounded-2xl bg-white" style={styles.logoCard}>
                <LogoIcon height={30} color={colors.primary} />
              </View>
            </View>
          </View>
        </View>

        {/* BODY — title, description, (loud) unverified warning, CTAs. */}
        <View className="px-5 pt-6">
          <ThemedText style={[styles.title, { color: colors.text }]}>
            {t('signInApproval.approve.titleWithOxy', { app: appName })}
          </ThemedText>

          {originVerified && info.application.isOfficial ? (
            <View className="mt-2 flex-row items-center justify-center gap-1">
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

          <ThemedText style={[styles.description, { color: colors.textSecondary }]} numberOfLines={5}>
            {description}
          </ThemedText>

          {!originVerified ? (
            <View className="pt-4">
              <ImportantBanner
                icon="alert"
                title={t('signInApproval.approve.unverifiedTitle')}
                style={styles.bannerFlush}
              >
                {t('signInApproval.approve.unverifiedBody')}
              </ImportantBanner>
            </View>
          ) : null}

          <View className="pb-1 pt-4">
            <PrimaryButton
              label={state === 'approving' ? t('signInApproval.approve.approving') : t('signInApproval.approve.approve')}
              onPress={approve}
              disabled={busy}
            />
            <View className="items-center pt-2">
              <SecondaryButton
                label={state === 'denying' ? t('signInApproval.approve.denying') : t('signInApproval.approve.deny')}
                onPress={deny}
                disabled={busy}
                fullWidth={false}
              />
            </View>
          </View>

          {biometricFailed ? (
            <View className="pt-1">
              <Callout tone="danger" icon="fingerprint">
                {t('signInApproval.approve.biometricFailedBody')}
              </Callout>
            </View>
          ) : null}
        </View>

        {/* FOOTER — scope summary + optional privacy/terms. */}
        <View className="gap-2.5 px-5 pb-7 pt-5">
          <View className="gap-1.5">
            <ThemedText style={[styles.footerText, { color: colors.textSecondary }]}>
              <ThemedText style={[styles.footerLead, { color: colors.text }]}>
                {t('signInApproval.approve.controlTitle')}{' '}
              </ThemedText>
              {t('signInApproval.approve.scopesTitle')}:
            </ThemedText>
            {scopes.length > 0 ? (
              <View className="gap-1">
                {scopes.map((scope) => (
                  <View key={scope} className="flex-row items-center gap-2">
                    <MaterialCommunityIcons name="check" size={14} color={colors.success} />
                    <ThemedText style={[styles.footerText, { color: colors.textSecondary }]}>{scope}</ThemedText>
                  </View>
                ))}
              </View>
            ) : null}
            {info.boundOrigin ? (
              <ThemedText style={[styles.footerText, { color: colors.textSecondary }]} numberOfLines={1}>
                {t('signInApproval.approve.originLabel')}: {info.boundOrigin}
              </ThemedText>
            ) : null}
          </View>

          {hasLegalLinks ? (
            <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
              {info.application.privacyPolicyUrl ? (
                <Pressable onPress={() => openLink(info.application.privacyPolicyUrl ?? '')} accessibilityRole="link">
                  <ThemedText style={[styles.legalLink, { color: colors.tint }]}>
                    {t('signInApproval.approve.privacyLink')}
                  </ThemedText>
                </Pressable>
              ) : null}
              {info.application.termsUrl ? (
                <Pressable onPress={() => openLink(info.application.termsUrl ?? '')} accessibilityRole="link">
                  <ThemedText style={[styles.legalLink, { color: colors.tint }]}>
                    {t('signInApproval.approve.termsLink')}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <Dialog
      control={control}
      onClose={navigateAway}
      placement="bottom"
      contentPadding={0}
      showHandle={false}
      label={t('signInApproval.approve.heading')}
    >
      <ScrollView
        className="w-full"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {content}
      </ScrollView>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  closeButton: {
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  logoCard: {
    borderCurve: 'continuous',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  logoInitial: {
    fontSize: 24,
    fontWeight: '700',
  },
  pairingDivider: {
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  title: {
    fontSize: 24,
    fontWeight: '500',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  officialText: {
    fontSize: 12,
    fontWeight: '600',
  },
  developer: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  bannerFlush: {
    marginBottom: 0,
  },
  footerText: {
    fontSize: 12,
    lineHeight: 17,
  },
  footerLead: {
    fontSize: 12,
    fontWeight: '700',
  },
  legalLink: {
    fontSize: 12,
    fontWeight: '600',
  },
});

/**
 * Route-level error boundary — preserves the branded retry UX this surface had
 * while it lived under `(scan)/_layout.tsx`, now that it is a root route.
 */
export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}
