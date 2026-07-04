/**
 * OxyAuthScreen — Sign in with Oxy (native bottom-sheet container).
 *
 * Two phases, Google-style:
 *  1. Account chooser (FRONT screen, shown when the device/user already has
 *     accounts): pick an account to continue as — one tap switches through the
 *     SAME `switchToAccount` path the account switcher uses — or "Use another
 *     account" to reveal the sign-in options.
 *  2. Sign-in options: the first-party password flow (identifier → password →
 *     optional 2FA, `usePasswordSignIn`) as the PRIMARY action, with the
 *     cross-app device flow (same-device deep-link + "sign in on another device"
 *     QR) as a SECONDARY option below an "or" divider.
 *
 * The device-flow machinery lives in the shared `useOxyAuthSession` hook (the
 * web `SignInModal` consumes it too). This screen should NOT be used within the
 * Oxy Accounts app itself.
 */

import type React from 'react';
import { useCallback, useState } from 'react';
import { View, TextInput, Linking, type TextStyle } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { useTheme } from '@oxyhq/bloom/theme';
import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { H4, Text } from '@oxyhq/bloom/typography';
import { IconCircle } from '@oxyhq/bloom/icon-circle';
import * as Icons from '@oxyhq/bloom/icons';
import { toast } from '@oxyhq/bloom';
import { isDev, logger as loggerUtil } from '@oxyhq/core';
import { useOxy } from '../context/OxyContext';
import OxyLogo from '../components/OxyLogo';
import AnotherDeviceQR from '../components/AnotherDeviceQR';
import LoadingState from '../components/LoadingState';
import SignInAccountChooser from '../components/SignInAccountChooser';
import { useSwitchableAccounts, type SwitchableAccount } from '../hooks/useSwitchableAccounts';
import { useI18n } from '../hooks/useI18n';
import { useOxyAuthSession, OXY_ACCOUNTS_WEB_URL } from '../hooks/useOxyAuthSession';
import { usePasswordSignIn } from '../hooks/usePasswordSignIn';

const OxyAuthScreen: React.FC<BaseScreenProps> = ({ goBack, onAuthenticated }) => {
  const bloomTheme = useTheme();
  const { oxyServices, handleWebSession, clientId, switchToAccount } = useOxy();
  const { t } = useI18n();
  const { accounts } = useSwitchableAccounts();

  const [useAnother, setUseAnother] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const showChooser = !useAnother && accounts.length > 0;

  const { qrData, qrPayload, isLoading, error, isWaiting, openSameDeviceApproval, retry } = useOxyAuthSession(
    oxyServices,
    clientId,
    handleWebSession,
    { onSignedIn: onAuthenticated },
  );

  const pw = usePasswordSignIn({ onSignedIn: onAuthenticated });

  const handleSelectAccount = useCallback(async (account: SwitchableAccount) => {
    if (account.isCurrent) {
      onAuthenticated?.();
      return;
    }
    if (switchingId) return;
    setSwitchingId(account.accountId);
    try {
      await switchToAccount(account.accountId);
      onAuthenticated?.();
    } catch (switchError) {
      if (isDev()) {
        loggerUtil.warn('OxyAuthScreen: switch account failed', { component: 'OxyAuthScreen' }, switchError as unknown);
      }
      toast.error(t('accountSwitcher.toasts.switchFailed') || 'Failed to switch account');
    } finally {
      setSwitchingId(null);
    }
  }, [switchingId, switchToAccount, onAuthenticated, t]);

  const inputStyle: TextStyle = {
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    marginBottom: 12,
    borderColor: bloomTheme.colors.border,
    color: bloomTheme.colors.text,
    backgroundColor: bloomTheme.colors.backgroundSecondary,
  };

  const title = showChooser ? 'Choose an account' : 'Sign in to Oxy';
  const subtitle = showChooser
    ? 'Continue as an account below, or use another.'
    : 'Continue with your Oxy identity to sign in securely';

  return (
    <View className="flex-1 items-center justify-center bg-bg px-screen-margin">
      {/* Branded header */}
      <View className="items-center mb-space-24 gap-space-12">
        <OxyLogo variant="icon" size={52} />
        <H4 className="text-headerBold font-headerBold text-text text-center">{title}</H4>
        <Text className="font-sans text-body text-text-secondary text-center">{subtitle}</Text>
      </View>

      {showChooser ? (
        <SignInAccountChooser
          accounts={accounts}
          onSelectAccount={handleSelectAccount}
          onUseAnother={() => setUseAnother(true)}
          pendingAccountId={switchingId}
          disabled={switchingId !== null}
        />
      ) : (
        <>
          {/* Back to the chooser when accounts exist. */}
          {accounts.length > 0 && (
            <Button
              variant="text"
              size="small"
              className="self-start mb-space-8"
              onPress={() => setUseAnother(false)}
              accessibilityLabel="Choose an account"
              icon={<Icons.ArrowLeft_Stroke2_Corner0_Rounded size="sm" style={{ color: bloomTheme.colors.textSecondary }} />}
            >
              Choose an account
            </Button>
          )}

          {/* PRIMARY — first-party password sign-in. Always usable; the device-flow
              loading/error state below never gates it. */}
          <View className="w-full">
            {pw.step === 'identifier' && (
              <TextInput
                style={inputStyle}
                value={pw.identifier}
                onChangeText={pw.setIdentifier}
                onSubmitEditing={pw.submitIdentifier}
                placeholder="Username or email"
                placeholderTextColor={bloomTheme.colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
                accessibilityLabel="Username or email"
              />
            )}

            {pw.step === 'password' && (
              <>
                <Text className="font-sans text-body text-text-secondary text-center mb-space-12">
                  {pw.identifier}
                </Text>
                <TextInput
                  style={inputStyle}
                  value={pw.password}
                  onChangeText={pw.setPassword}
                  onSubmitEditing={pw.submitPassword}
                  placeholder="Password"
                  placeholderTextColor={bloomTheme.colors.textSecondary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  accessibilityLabel="Password"
                />
              </>
            )}

            {pw.step === 'twoFactor' && (
              <TextInput
                style={inputStyle}
                value={pw.code}
                onChangeText={pw.setCode}
                onSubmitEditing={pw.submitTwoFactor}
                placeholder={pw.useBackupCode ? 'Backup code' : '6-digit code'}
                placeholderTextColor={bloomTheme.colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={pw.useBackupCode ? 'default' : 'number-pad'}
                returnKeyType="go"
                accessibilityLabel={pw.useBackupCode ? 'Backup code' : 'Two-factor code'}
              />
            )}

            <Button
              variant="primary"
              size="large"
              fullWidth
              className="w-full"
              onPress={
                pw.step === 'identifier' ? pw.submitIdentifier
                  : pw.step === 'password' ? pw.submitPassword
                    : pw.submitTwoFactor
              }
              loading={pw.isSubmitting}
              disabled={pw.isSubmitting}
            >
              {pw.step === 'identifier' ? 'Continue' : pw.step === 'password' ? 'Sign in' : 'Verify'}
            </Button>

            {pw.error && (
              <Text className="font-sans text-body text-destructive text-center mt-space-12">
                {pw.error}
              </Text>
            )}

            {pw.step === 'twoFactor' && (
              <Button
                variant="text"
                size="small"
                className="mt-space-8"
                onPress={() => pw.setUseBackupCode(!pw.useBackupCode)}
              >
                {pw.useBackupCode ? 'Use authenticator code' : 'Use a backup code'}
              </Button>
            )}

            {pw.step !== 'identifier' && (
              <Button
                variant="text"
                size="small"
                className="mt-space-8"
                onPress={pw.back}
                accessibilityLabel="Back"
              >
                Back
              </Button>
            )}
          </View>

          {/* "or" divider — separates the password form from the SECONDARY device flow. */}
          <View className="flex-row items-center w-full my-space-16 gap-space-8">
            <View className="flex-1" style={{ height: 1, backgroundColor: bloomTheme.colors.border }} />
            <Text className="font-sans text-caption text-text-tertiary">or</Text>
            <View className="flex-1" style={{ height: 1, backgroundColor: bloomTheme.colors.border }} />
          </View>

          {/* SECONDARY — cross-app device flow. Its loading/error state gates ONLY
              this section; the password form above is always usable. */}
          {isLoading ? (
            <LoadingState
              size="small"
              color={bloomTheme.colors.primary}
              message="Preparing sign in…"
            />
          ) : error ? (
            <View className="items-center gap-space-16 w-full">
              <IconCircle icon={Icons.Warning_Stroke2_Corner0_Rounded} />
              <Text className="font-sans text-body text-text-secondary text-center">{error}</Text>
              <Button
                variant="secondary"
                fullWidth
                className="w-full"
                onPress={retry}
                icon={
                  <Icons.ArrowRotateClockwise_Stroke2_Corner0_Rounded
                    size="sm"
                    style={{ color: bloomTheme.colors.text }}
                  />
                }
              >
                Try Again
              </Button>
            </View>
          ) : (
            <>
              {qrPayload && (
                <Button
                  variant="secondary"
                  size="large"
                  fullWidth
                  className="w-full"
                  onPress={openSameDeviceApproval}
                  icon={<OxyLogo variant="icon" size={20} fillColor={bloomTheme.colors.text} />}
                >
                  Sign in with the Oxy app
                </Button>
              )}

              {isWaiting && (
                <View className="flex-row items-center mt-space-16 gap-space-8">
                  <Loading size="small" />
                  <Text className="font-sans text-body text-text-secondary">
                    Waiting for authorization…
                  </Text>
                </View>
              )}

              <View className="w-full mt-space-24">
                <AnotherDeviceQR qrData={qrData} qrPayload={qrPayload} />
              </View>
            </>
          )}
        </>
      )}

      {/* Footer — create an account */}
      <View className="flex-row flex-wrap justify-center items-center mt-space-24">
        <Text className="font-sans text-body text-text-secondary">
          Don't have an Oxy account?
        </Text>
        <Button
          variant="text"
          size="small"
          onPress={() => Linking.openURL(OXY_ACCOUNTS_WEB_URL)}
          accessibilityLabel="Create an Oxy account"
        >
          Create one
        </Button>
      </View>

      {/* Cancel */}
      {goBack && (
        <Button variant="text" onPress={goBack} className="mt-space-8" accessibilityLabel="Cancel">
          Cancel
        </Button>
      )}
    </View>
  );
};

export default OxyAuthScreen;
