/**
 * Global, non-dismissible auth gate.
 *
 * When the user is not authenticated, blocks the entire app behind a Bloom
 * surface containing the brand logo, hero copy, and the `OxySignInButton`.
 * The underlying app chrome continues to render so that as soon as auth flips
 * to true the gate vanishes and the user lands exactly where they were.
 *
 * Responsive surface:
 *  - `width < 768`        → Bloom `BottomSheet` (mobile / phones).
 *  - `width >= 768`       → Bloom `Dialog`, web-centered (tablet / desktop).
 *
 * Non-dismissibility strategy per surface:
 *  - `BottomSheet` supports `enablePanDownToClose={false}` (no pan gesture) and
 *    `onDismissAttempt: () => false` (blocks backdrop tap + Android back).
 *    A `backdropComponent` is supplied with no `onPress` so the backdrop is
 *    inert. Result: truly locked open — cannot be dismissed by user input.
 *  - `Dialog` (`@gorhom/bottom-sheet`-backed on native, `Portal`-backed on
 *    web) does NOT expose a "non-dismissible" prop. If the user manages to
 *    close it (Esc on web, backdrop tap, swipe down on native), `onClose`
 *    fires and the gate immediately re-opens the dialog on the next frame so
 *    it appears continuously open. While `!isAuthenticated`, the gate stays.
 *
 * Auth source: `useOxy()` from `@oxyhq/services` — single source of truth used
 * throughout the app. `isLoading` is respected so the gate does not flash on
 * cold start while the session is restored from storage.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet, type BottomSheetRef } from '@oxyhq/bloom/bottom-sheet';
import * as Dialog from '@oxyhq/bloom/dialog';
import { H2, P, Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import { OxySignInButton, useOxy } from '@oxyhq/services';

import { LogoIcon } from '@/assets/logo';
import { useTranslation } from '@/lib/i18n';

/**
 * Desktop / tablet breakpoint at which the gate switches from a bottom sheet
 * to a centered dialog. Matches the task spec — note this is intentionally
 * lower than the `900` value used elsewhere in inbox for split-view layouts,
 * since a modal sign-in surface reads better as a dialog on tablets too.
 */
const DIALOG_BREAKPOINT = 768;

/** No-op backdrop — fully inert so backdrop taps do nothing. */
function InertBackdrop() {
  return (
    <View
      pointerEvents="auto"
      style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
    />
  );
}

/** Returns `false` to block any programmatic dismiss attempt. */
const blockDismiss = (): boolean => false;

export function AuthGate() {
  const { isAuthenticated, isLoading } = useOxy();
  const { width } = useWindowDimensions();

  // Wait for the auth restore to finish so the gate doesn't flash on the
  // first render while the session is rehydrating from storage.
  if (isLoading) return null;
  if (isAuthenticated) return null;

  const useDialog = width >= DIALOG_BREAKPOINT;

  return useDialog ? <AuthGateDialog /> : <AuthGateSheet />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile surface — Bloom BottomSheet, structurally locked open.
// ─────────────────────────────────────────────────────────────────────────────

function AuthGateSheet() {
  const sheetRef = useRef<BottomSheetRef>(null);

  // Imperative present on mount — Bloom's BottomSheet starts hidden and only
  // animates in when `present()` is called. This is the standard pattern used
  // by SnoozeSheet / ScheduleSendSheet in the same codebase.
  useEffect(() => {
    sheetRef.current?.present();
  }, []);

  return (
    <BottomSheet
      ref={sheetRef}
      enablePanDownToClose={false}
      enableHandlePanningGesture={false}
      onDismissAttempt={blockDismiss}
      backdropComponent={InertBackdrop}
      detached={false}
    >
      <AuthGateContent />
    </BottomSheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tablet / desktop surface — Bloom Dialog, re-open-on-close fallback.
// ─────────────────────────────────────────────────────────────────────────────

function AuthGateDialog() {
  const control = Dialog.useDialogControl();

  // Open the dialog on mount. The control object is stable across renders
  // (refs from `useDialogControl`), so this only fires once.
  useEffect(() => {
    control.open();
  }, [control]);

  // If anything dismisses the dialog (Esc on web, gesture on native), reopen
  // it on the next frame. The gate component unmounts entirely when the user
  // becomes authenticated, so this loop terminates cleanly at that moment.
  const handleClose = useCallback(() => {
    // Defer to next macrotask so the open happens after the close lifecycle
    // settles inside Dialog.Outer (avoids fighting the close animation).
    setTimeout(() => {
      control.open();
    }, 0);
  }, [control]);

  return (
    <Dialog.Outer
      control={control}
      onClose={handleClose}
      webOptions={{ alignCenter: true }}
    >
      <Dialog.Inner
        label="Sign in required"
        contentContainerStyle={styles.dialogInner}
      >
        <AuthGateContent variant="dialog" />
      </Dialog.Inner>
    </Dialog.Outer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared visual content — logo, hero copy, sign-in button, footer disclaimer.
// ─────────────────────────────────────────────────────────────────────────────

interface AuthGateContentProps {
  variant?: 'sheet' | 'dialog';
}

function AuthGateContent({ variant = 'sheet' }: AuthGateContentProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Sheet content sits flush against the safe-area bottom; the dialog has
  // its own internal padding via `Dialog.Inner`, so we only add insets for
  // the sheet variant.
  const sheetExtraPadding =
    variant === 'sheet' ? { paddingBottom: insets.bottom + 32 } : null;

  return (
    <View style={[styles.content, sheetExtraPadding]}>
      <View style={[styles.logoBadge, { backgroundColor: colors.primarySubtle }]}>
        <LogoIcon height={44} color={colors.primary} />
      </View>

      <View style={styles.copy}>
        <H2 style={styles.title}>{t('auth.gate.title')}</H2>
        <P style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('auth.gate.subtitle')}
        </P>
      </View>

      <OxySignInButton variant="contained" style={styles.cta} />

      <Text style={[styles.footer, { color: colors.textTertiary }]}>
        {t('auth.gate.footer')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 28,
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: 'center',
    gap: 20,
    // On web, ensure the Pressable container inside the Dialog stretches to
    // the dialog's inner width so the centered hero layout matches the
    // bottom-sheet variant.
    width: '100%',
    ...Platform.select({
      web: { maxWidth: 480, marginHorizontal: 'auto' as const },
      default: {},
    }),
  },
  logoBadge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  copy: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 24,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 360,
  },
  cta: {
    marginTop: 4,
    width: '100%',
    maxWidth: 320,
  },
  footer: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    maxWidth: 320,
    marginTop: 4,
  },
  dialogInner: {
    padding: 0,
  },
});
