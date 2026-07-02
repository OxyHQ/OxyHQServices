import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Linking, ScrollView } from 'react-native';
import { toast } from '@oxyhq/bloom';
import { TextFieldInput } from '@oxyhq/bloom/text-field';
import { useOxy, LogoText, showSignInModal } from '@oxyhq/services';
import { logger, type SessionLoginResponse } from '@oxyhq/core';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui';
import { extractAuthErrorMessage } from '@/utils/auth/errorUtils';
import { CREATE_ACCOUNT_HELP_URL } from '@/constants/auth';

/**
 * Sign-In Screen (the only `(auth)` route)
 *
 * Accounts is a management-only app: a user's cryptographic identity (private
 * keys, recovery phrase) lives in the Commons app, never here. This screen
 * authenticates the user against an existing Oxy account and offers two
 * paths, both under the unified "Sign in with Oxy" umbrella:
 *
 *   1. Username/email + password (`useOxy().signInWithPassword`) — with the
 *      2FA challenge handled inline via `POST /security/2fa/verify-login`.
 *   2. "Sign in with Oxy" handoff — the SDK's `SignInModal` (QR for another
 *      device + same-device deep-link to the Oxy app + one-tap approval).
 *
 * Cross-domain web restore (per-apex `/auth/silent` iframe + `/sso` bounce) is
 * owned entirely by the SDK's `OxyProvider` cold boot — this screen never wires
 * it. There is no FedCM path: FedCM was removed from the client sign-in surface.
 *
 * The root Stack (`app/_layout.tsx`) owns the `(auth)`↔`(tabs)` swap keyed on
 * session, so this screen never navigates across that boundary itself: it
 * renders a neutral backdrop while auth is still resolving or once the user is
 * authenticated, and lets the root perform the swap. This avoids the
 * render/redirect race that a child-screen cross-group navigation would cause.
 */

type SignInStep = 'credentials' | 'twoFactor';

export default function SignInScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const {
    oxyServices,
    signInWithPassword,
    handleWebSession,
    isAuthenticated,
    isAuthResolved,
  } = useOxy();

  const [step, setStep] = useState<SignInStep>('credentials');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loginToken, setLoginToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmitCredentials = identifier.trim().length > 0 && password.length > 0;

  const handlePasswordSignIn = useCallback(async () => {
    if (isSubmitting || !canSubmitCredentials) return;
    setIsSubmitting(true);
    try {
      const result = await signInWithPassword(identifier.trim(), password);
      if (result.status === '2fa_required') {
        // The account has 2FA enabled — no session was committed. Move to the
        // verification step and carry the short-lived loginToken forward.
        setLoginToken(result.loginToken);
        setStep('twoFactor');
        return;
      }
      // result.status === 'ok' — the SDK committed the session. `isAuthenticated`
      // flips and the root Stack swaps into `(tabs)`; nothing to do here.
    } catch (error) {
      logger.error(
        'SignInScreen: password sign-in failed',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'SignInScreen' },
      );
      toast.error(extractAuthErrorMessage(error, t('auth.signIn.errors.credentials')));
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, canSubmitCredentials, signInWithPassword, identifier, password, t]);

  const handleVerifyTwoFactor = useCallback(async () => {
    if (isSubmitting || !loginToken || code.trim().length === 0) return;
    setIsSubmitting(true);
    try {
      // The 2FA endpoint creates the session and returns the same shape as a
      // password login; commit it through the shared web-session path so auth
      // state, persistence, and profile fetch all run identically.
      const session = await oxyServices.makeRequest<SessionLoginResponse>(
        'POST',
        '/security/2fa/verify-login',
        { loginToken, token: code.trim() },
        { cache: false },
      );
      await handleWebSession(session);
    } catch (error) {
      logger.error(
        'SignInScreen: 2FA verification failed',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'SignInScreen' },
      );
      toast.error(extractAuthErrorMessage(error, t('auth.signIn.errors.twoFactor')));
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, loginToken, code, oxyServices, handleWebSession, t]);

  const handleBackToCredentials = useCallback(() => {
    setStep('credentials');
    setCode('');
    setLoginToken(null);
  }, []);

  const handleSignInWithOxy = useCallback(() => {
    // Opens the SDK's shared sign-in surface: QR for another device, a
    // same-device deep-link to the Oxy app, and one-tap approval. The modal is
    // mounted by OxyProvider; this just reveals it.
    showSignInModal();
  }, []);

  const handleGetTheApp = useCallback(() => {
    Linking.openURL(CREATE_ACCOUNT_HELP_URL).catch((error) => {
      logger.error(
        'SignInScreen: failed to open get-the-app URL',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'SignInScreen' },
      );
    });
  }, []);

  const containerStyle = useMemo(
    () => [styles.container, { backgroundColor: colors.background }],
    [colors.background],
  );

  // Neutral backdrop while the session is still resolving, or once the user is
  // authenticated (the root Stack will swap to `(tabs)`). Rendering the form in
  // those windows would flash sign-in UI at a returning user.
  if (!isAuthResolved || isAuthenticated) {
    return <View style={containerStyle} />;
  }

  return (
    <ScrollView
      style={containerStyle}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.content}>
        <LogoText height={40} style={styles.logo} />

        {step === 'credentials' ? (
          <>
            <Text style={[styles.title, { color: colors.text }]}>
              {t('auth.signIn.title')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('auth.signIn.subtitle')}
            </Text>

            <View style={styles.form}>
              <TextFieldInput
                floatingLabel
                label={t('auth.signIn.identifierLabel')}
                value={identifier}
                onChangeText={setIdentifier}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                returnKeyType="next"
                editable={!isSubmitting}
                testID="sign-in-identifier"
              />
              <TextFieldInput
                floatingLabel
                label={t('auth.signIn.passwordLabel')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                returnKeyType="go"
                editable={!isSubmitting}
                onSubmitEditing={handlePasswordSignIn}
                testID="sign-in-password"
              />
              <Button
                variant="primary"
                onPress={handlePasswordSignIn}
                loading={isSubmitting}
                disabled={isSubmitting || !canSubmitCredentials}
                style={styles.primaryButton}
                testID="sign-in-submit"
              >
                {t('auth.signIn.submit')}
              </Button>
            </View>

            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.dividerText, { color: colors.textSecondary }]}>
                {t('auth.signIn.or')}
              </Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            </View>

            <View style={styles.actions}>
              <Button
                variant="secondary"
                onPress={handleSignInWithOxy}
                disabled={isSubmitting}
                style={styles.secondaryButton}
                testID="sign-in-with-oxy"
              >
                {t('auth.signIn.withOxy')}
              </Button>
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: colors.text }]}>
              {t('auth.signIn.twoFactor.title')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('auth.signIn.twoFactor.subtitle')}
            </Text>

            <View style={styles.form}>
              <TextFieldInput
                floatingLabel
                label={t('auth.signIn.twoFactor.codeLabel')}
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                returnKeyType="go"
                editable={!isSubmitting}
                onSubmitEditing={handleVerifyTwoFactor}
                testID="sign-in-2fa-code"
              />
              <Button
                variant="primary"
                onPress={handleVerifyTwoFactor}
                loading={isSubmitting}
                disabled={isSubmitting || code.trim().length === 0}
                style={styles.primaryButton}
                testID="sign-in-2fa-verify"
              >
                {t('auth.signIn.twoFactor.verify')}
              </Button>
              <Button
                variant="ghost"
                onPress={handleBackToCredentials}
                disabled={isSubmitting}
                style={styles.secondaryButton}
                testID="sign-in-2fa-back"
              >
                {t('auth.signIn.twoFactor.back')}
              </Button>
            </View>
          </>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>
          {t('auth.signIn.noAccount')}
        </Text>
        <Button
          variant="ghost"
          onPress={handleGetTheApp}
          style={styles.footerButton}
          testID="sign-in-get-app"
        >
          {t('auth.signIn.getTheApp')}
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 48,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  logo: {
    alignSelf: 'center',
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
    marginBottom: 32,
  },
  form: {
    width: '100%',
    gap: 16,
  },
  primaryButton: {
    width: '100%',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    fontSize: 13,
    textTransform: 'uppercase',
  },
  actions: {
    width: '100%',
    gap: 12,
  },
  secondaryButton: {
    width: '100%',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    paddingTop: 24,
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
