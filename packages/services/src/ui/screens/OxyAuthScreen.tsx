/**
 * OxyAuthScreen - Sign in with Oxy (native bottom-sheet container)
 *
 * Used by OTHER apps in the Oxy ecosystem to authenticate users. The primary
 * action is the one-tap "Continue with Oxy" approval flow (opens the Oxy Auth
 * web flow with a deep-link `redirect_uri` so the app→app return path can
 * complete the sign-in). The QR code is demoted to a collapsed "Sign in on
 * another device" disclosure — you can't scan your own screen.
 *
 * ALL of the auth-session machinery (session-token creation, QR data, socket +
 * polling, the native deep-link return path, waiting/error/retry state, the
 * open-auth handler, and cleanup) lives in the shared `useOxyAuthSession` hook,
 * which the web `SignInModal` also consumes — neither container re-implements
 * the transport. The Oxy Accounts app is where users manage their cryptographic
 * identity; this screen should NOT be used within the Accounts app itself.
 */

import type React from 'react';
import { View, Linking } from 'react-native';
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

const OxyAuthScreen: React.FC<BaseScreenProps> = ({ goBack, onAuthenticated }) => {
  const bloomTheme = useTheme();
  const { oxyServices, switchSession, clientId } = useOxy();

  const { qrData, qrPayload, isLoading, error, isWaiting, openAuthApproval, openSameDeviceApproval, retry } = useOxyAuthSession(
    oxyServices,
    clientId,
    switchSession,
    { onSignedIn: onAuthenticated },
  );

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <LoadingState
          size="large"
          color={bloomTheme.colors.primary}
          message="Preparing sign in..."
        />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-screen-margin gap-space-16">
        <IconCircle icon={Icons.Warning_Stroke2_Corner0_Rounded} />
        <Text className="font-sans text-body text-text-secondary text-center">{error}</Text>
        <Button
          variant="primary"
          fullWidth
          className="w-full"
          onPress={retry}
          icon={
            <Icons.ArrowRotateClockwise_Stroke2_Corner0_Rounded
              size="sm"
              style={{ color: bloomTheme.colors.primaryForeground }}
            />
          }
        >
          Try Again
        </Button>
      </View>
    );
  }

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

      {/* Primary action — Continue with Oxy */}
      <Button
        variant="primary"
        size="large"
        fullWidth
        className="w-full"
        onPress={openAuthApproval}
        icon={
          <OxyLogo variant="icon" size={20} fillColor={bloomTheme.colors.primaryForeground} />
        }
      >
        Continue with Oxy
      </Button>

      {/* Same-device "Sign in with Oxy" handoff — deep-links into the native Oxy
          app to approve. Shown only when the handoff backend returned a payload. */}
      {qrPayload && (
        <Button
          variant="secondary"
          size="large"
          fullWidth
          className="w-full mt-space-12"
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

      {/* Collapsed "sign in on another device" QR disclosure */}
      <View className="w-full mt-space-24">
        <AnotherDeviceQR qrData={qrData} qrPayload={qrPayload} />
      </View>

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
