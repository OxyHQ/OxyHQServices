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
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { useTheme } from '@oxyhq/bloom/theme';
import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { useOxy } from '../context/OxyContext';
import OxyLogo from '../components/OxyLogo';
import AnotherDeviceQR from '../components/AnotherDeviceQR';
import { useOxyAuthSession, OXY_ACCOUNTS_WEB_URL } from '../hooks/useOxyAuthSession';

const OxyAuthScreen: React.FC<BaseScreenProps> = ({ goBack, onAuthenticated }) => {
  const bloomTheme = useTheme();
  const { oxyServices, switchSession, clientId } = useOxy();

  const { qrData, isLoading, error, isWaiting, openAuthApproval, retry } = useOxyAuthSession(
    oxyServices,
    clientId,
    switchSession,
    { onSignedIn: onAuthenticated },
  );

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
        <Loading size="large" />
        <Text style={styles.loadingText} className="text-muted-foreground">
          Preparing sign in...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
        <Text style={styles.errorText} className="text-destructive">{error}</Text>
        <Button variant="primary" onPress={retry} style={styles.primaryButton}>
          Try Again
        </Button>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
      {/* Branded header */}
      <View style={styles.header}>
        <OxyLogo variant="icon" size={48} />
        <Text style={styles.title} className="text-foreground">Sign in to Oxy</Text>
        <Text style={styles.subtitle} className="text-muted-foreground">
          Continue with your Oxy identity to sign in securely
        </Text>
      </View>

      {/* Primary action — Continue with Oxy */}
      <Button
        variant="primary"
        onPress={openAuthApproval}
        icon={<OxyLogo variant="icon" size={20} fillColor={bloomTheme.colors.primaryForeground} style={styles.buttonIcon} />}
        style={styles.primaryButton}
      >
        Continue with Oxy
      </Button>

      {/* Waiting status */}
      {isWaiting && (
        <View style={styles.statusContainer}>
          <Loading size="small" style={styles.statusSpinner} />
          <Text style={styles.statusText} className="text-muted-foreground">
            Waiting for authorization...
          </Text>
        </View>
      )}

      {/* Collapsed "sign in on another device" QR disclosure */}
      <View style={styles.qrSection}>
        <AnotherDeviceQR qrData={qrData} />
      </View>

      {/* Footer — create an account */}
      <View style={styles.footer}>
        <Text style={styles.footerText} className="text-muted-foreground">
          Don't have an Oxy account?{' '}
        </Text>
        <TouchableOpacity onPress={() => Linking.openURL(OXY_ACCOUNTS_WEB_URL)} accessibilityRole="link">
          <Text style={styles.footerLink} className="text-primary">
            Create one
          </Text>
        </TouchableOpacity>
      </View>

      {/* Cancel */}
      {goBack && (
        <TouchableOpacity style={styles.cancelButton} onPress={goBack} accessibilityRole="button">
          <Text style={styles.cancelText} className="text-muted-foreground">Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    borderRadius: 12,
  },
  buttonIcon: {
    marginRight: 10,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  statusSpinner: {
    flex: undefined,
  },
  statusText: {
    marginLeft: 8,
    fontSize: 14,
  },
  qrSection: {
    width: '100%',
    marginTop: 24,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 28,
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: '600',
  },
  cancelButton: {
    marginTop: 16,
    padding: 12,
  },
  cancelText: {
    fontSize: 14,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
});

export default OxyAuthScreen;
