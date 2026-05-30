import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Platform, Linking } from 'react-native';
import { Redirect } from 'expo-router';
import { toast } from '@oxyhq/bloom';
import { useOxy } from '@oxyhq/services';
import { logger } from '@oxyhq/core';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import { Logo, Button } from '@/components/ui';
import { extractAuthErrorMessage } from '@/utils/auth/errorUtils';
import { CREATE_ACCOUNT_HELP_URL } from '@/constants/auth';

/**
 * Sign-In Screen (Web entry point)
 *
 * Web is a management surface for an EXISTING Oxy account — identity
 * CREATION is native-only (key generation, recovery phrase). An
 * unauthenticated web visitor lands here and authenticates against an
 * account that was created on the native app.
 *
 * Sign-in uses FedCM (Federated Credential Management) — the browser-native,
 * privacy-preserving cross-domain identity standard. `OxyContext` already runs
 * a SILENT FedCM check on mount; this screen provides the EXPLICIT,
 * user-gesture-initiated sign-in that browsers require when silent mediation
 * is unavailable (no prior consent, or returning after sign-out).
 *
 * This screen never creates an identity. The only path to a new account is the
 * native app, surfaced here as a help link.
 *
 * Loop-safety: if this screen is ever reached on native (it shouldn't be — the
 * native `(auth)` entry renders the create-identity welcome), it redirects to
 * the welcome flow rather than rendering web-only sign-in UI. When the user is
 * already authenticated, it redirects into the app shell so the back stack and
 * deep links resolve to a real screen instead of a dead-end sign-in page.
 */
export default function SignInScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { oxyServices, handlePopupSession, isAuthenticated } = useOxy();
  const [isSigningIn, setIsSigningIn] = useState(false);

  const fedCMSupported = Platform.OS === 'web' && oxyServices.isFedCMSupported();

  const handleSignIn = useCallback(async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    try {
      const session = await oxyServices.signInWithFedCM();
      if (session) {
        // `handlePopupSession` updates auth state and persists the session.
        // Once `isAuthenticated` flips, the `(tabs)` guard takes over and the
        // root layout routes the user into the app shell — no manual nav here.
        await handlePopupSession(session);
      }
    } catch (error) {
      logger.error(
        'SignInScreen: FedCM sign-in failed',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'SignInScreen' },
      );
      toast.error(extractAuthErrorMessage(error, t('auth.signIn.error')));
    } finally {
      setIsSigningIn(false);
    }
  }, [isSigningIn, oxyServices, handlePopupSession, t]);

  const handleCreateAccount = useCallback(() => {
    Linking.openURL(CREATE_ACCOUNT_HELP_URL).catch((error) => {
      logger.error(
        'SignInScreen: failed to open create-account help URL',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'SignInScreen' },
      );
    });
  }, []);

  // Already authenticated (e.g. silent SSO succeeded while this screen was
  // mounted, or a deep link landed here with a live session) → enter the app.
  if (isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  // Defensive: this screen is web-only. On native, identity creation is the
  // entry point, so never render sign-in UI there — send users to the welcome
  // flow. This keeps the route loop-safe if reached via history or deep link.
  if (Platform.OS !== 'web') {
    return <Redirect href="/(auth)/welcome" />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Logo height={40} style={styles.logo} />

        <Text style={[styles.title, { color: colors.text }]}>
          {t('auth.signIn.title')}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('auth.signIn.subtitle')}
        </Text>

        <View style={styles.actions}>
          {fedCMSupported ? (
            <Button
              variant="primary"
              onPress={handleSignIn}
              loading={isSigningIn}
              disabled={isSigningIn}
              style={styles.primaryButton}
              testID="sign-in-fedcm"
            >
              {t('auth.signIn.button')}
            </Button>
          ) : (
            <Text style={[styles.unsupported, { color: colors.textSecondary }]}>
              {t('auth.signIn.unsupported')}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>
          {t('auth.signIn.noAccount')}
        </Text>
        <Button
          variant="ghost"
          onPress={handleCreateAccount}
          style={styles.footerButton}
          testID="sign-in-create-account"
        >
          {t('auth.signIn.createAccount')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  logo: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 40,
  },
  actions: {
    width: '100%',
    alignItems: 'center',
  },
  primaryButton: {
    width: '100%',
  },
  unsupported: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    alignItems: 'center',
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  footerText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  footerButton: {
    minWidth: 200,
  },
});
