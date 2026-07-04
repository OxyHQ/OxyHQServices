/**
 * OxyAuthScreen - Sign in with Oxy (native bottom-sheet container)
 *
 * Used by OTHER apps in the Oxy ecosystem to authenticate users. The PRIMARY
 * action is the first-party password flow (identifier → password → optional
 * 2FA), driven by `usePasswordSignIn`. Below an "or" divider, the cross-app
 * device flow is a SECONDARY option: a same-device "Sign in with the Oxy app"
 * deep-link plus a collapsed "Sign in on another device" QR disclosure (you
 * can't scan your own screen). The device-flow loading/error state only gates
 * that secondary section — the password form is always usable.
 *
 * The device-flow machinery (session-token creation, QR data, socket + polling,
 * the native deep-link return path, waiting/error/retry state, same-device
 * deep-link, and cleanup) lives in the shared `useOxyAuthSession` hook, which
 * the web `SignInModal` also consumes — neither container re-implements the
 * transport. The Oxy Accounts app is where users manage their cryptographic
 * identity; this screen should NOT be used within the Accounts app itself.
 */

import type React from 'react';
import { View, TextInput, Linking, type TextStyle } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { useTheme } from '@oxyhq/bloom/theme';
import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { H4, Text } from '@oxyhq/bloom/typography';
import { IconCircle } from '@oxyhq/bloom/icon-circle';
import * as Icons from '@oxyhq/bloom/icons';
import { useOxy } from '../context/OxyContext';
import OxyLogo from '../components/OxyLogo';
import AnotherDeviceQR from '../components/AnotherDeviceQR';
import LoadingState from '../components/LoadingState';
import { useOxyAuthSession, OXY_ACCOUNTS_WEB_URL } from '../hooks/useOxyAuthSession';
import { usePasswordSignIn } from '../hooks/usePasswordSignIn';

const OxyAuthScreen: React.FC<BaseScreenProps> = ({ goBack, onAuthenticated }) => {
  const bloomTheme = useTheme();
  const { oxyServices, handleWebSession, clientId } = useOxy();

  const { qrData, qrPayload, isLoading, error, isWaiting, openSameDeviceApproval, retry } = useOxyAuthSession(
    oxyServices,
    clientId,
    handleWebSession,
    { onSignedIn: onAuthenticated },
  );

  // First-party password sign-in — the PRIMARY action. On a committed session
  // the screen's `onAuthenticated` fires; the device-first cold boot then drives
  // the app into the authenticated state.
  const pw = usePasswordSignIn({ onSignedIn: onAuthenticated });

  const inputStyle: TextStyle = {
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
    borderColor: bloomTheme.colors.border,
    color: bloomTheme.colors.text,
    backgroundColor: bloomTheme.colors.backgroundSecondary,
  };

  return (
    <View className="flex-1 items-center justify-center bg-bg px-screen-margin">
      {/* Branded header */}
      <View className="items-center mb-space-24 gap-space-12">
        <OxyLogo variant="icon" size={56} />
        <H4 className="text-headerBold font-headerBold text-text text-center">
          Sign in to Oxy
        </H4>
        <Text className="font-sans text-body text-text-secondary text-center">
          Continue with your Oxy identity to sign in securely
        </Text>
      </View>

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

        {pw.step === 'identifier' && (
          <Button
            variant="primary"
            size="large"
            fullWidth
            className="w-full"
            onPress={pw.submitIdentifier}
            loading={pw.isSubmitting}
            disabled={pw.isSubmitting}
          >
            Continue
          </Button>
        )}

        {pw.step === 'password' && (
          <Button
            variant="primary"
            size="large"
            fullWidth
            className="w-full"
            onPress={pw.submitPassword}
            loading={pw.isSubmitting}
            disabled={pw.isSubmitting}
          >
            Sign in
          </Button>
        )}

        {pw.step === 'twoFactor' && (
          <Button
            variant="primary"
            size="large"
            fullWidth
            className="w-full"
            onPress={pw.submitTwoFactor}
            loading={pw.isSubmitting}
            disabled={pw.isSubmitting}
          >
            Verify
          </Button>
        )}

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
          this section; the password form above is always usable. In the
          device-first model these paths persist a durable session, so they are
          always shown when a payload exists. */}
      {isLoading ? (
        <LoadingState
          size="small"
          color={bloomTheme.colors.primary}
          message="Preparing sign in..."
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
          {/* Same-device "Sign in with Oxy" handoff — deep-links into the native
              Oxy app to approve. Shown only when the handoff backend returned a
              payload. */}
          {qrPayload && (
            <Button
              variant="secondary"
              size="large"
              fullWidth
              className="w-full"
              onPress={openSameDeviceApproval}
              icon={
                <OxyLogo variant="icon" size={20} fillColor={bloomTheme.colors.text} />
              }
            >
              Sign in with the Oxy app
            </Button>
          )}

          {/* Waiting status */}
          {isWaiting && (
            <View className="flex-row items-center mt-space-16 gap-space-8">
              <Loading size="small" />
              <Text className="font-sans text-body text-text-secondary">
                Waiting for authorization...
              </Text>
            </View>
          )}

          {/* Collapsed "sign in on another device" QR disclosure. */}
          <View className="w-full mt-space-24">
            <AnotherDeviceQR qrData={qrData} qrPayload={qrPayload} />
          </View>
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
