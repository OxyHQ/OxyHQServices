import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useOxy, KeyManager } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

/**
 * Authorize Screen
 * 
 * This screen is opened when a third-party app requests authentication.
 * It can be opened via:
 * - Deep link: oxyaccounts://authorize?token=xxx
 * - QR code scan (which opens this screen with the token)
 */
export default function AuthorizeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { oxyServices, user, isAuthenticated, activeSessionId } = useOxy();

  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{
    appId: string;
    expiresAt: string;
  } | null>(null);

  // Load session info
  useEffect(() => {
    loadSessionInfo();
  }, [params.token]);

  const loadSessionInfo = async () => {
    if (!params.token) {
      setError('No authorization token provided');
      setIsLoading(false);
      return;
    }

    try {
      const response = await oxyServices.makeRequest<{
        status: string;
        sessionToken: string;
        appId: string;
        expiresAt: string;
      }>('GET', `/api/auth/session/status/${params.token}`, undefined, { cache: false });

      if (response.status !== 'pending') {
        setError('This authorization request has already been processed or expired');
        setIsLoading(false);
        return;
      }

      setSessionInfo({
        appId: response.appId,
        expiresAt: response.expiresAt,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load authorization request');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuthorize = useCallback(async () => {
    if (!params.token || !activeSessionId) return;

    setIsAuthorizing(true);
    setError(null);

    try {
      await oxyServices.makeRequest('POST', `/api/auth/session/authorize/${params.token}`, {}, {
        cache: false,
        headers: {
          'x-session-id': activeSessionId,
        },
      });

      Alert.alert(
        'Authorization Successful',
        `You have authorized ${sessionInfo?.appId || 'the app'} to access your Oxy identity.`,
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );
    } catch (err: any) {
      setError(err.message || 'Failed to authorize');
    } finally {
      setIsAuthorizing(false);
    }
  }, [params.token, activeSessionId, oxyServices, sessionInfo, router]);

  const handleDeny = useCallback(async () => {
    if (!params.token) return;

    try {
      await oxyServices.makeRequest('POST', `/api/auth/session/cancel/${params.token}`, {}, {
        cache: false,
      });
    } catch {
      // Ignore errors when cancelling
    }

    router.back();
  }, [params.token, oxyServices, router]);

  // Check if user is authenticated
  if (!isAuthenticated || !user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>Sign In Required</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          You need to be signed in to authorize this request.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/(auth)')}
        >
          <Text style={styles.buttonText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading authorization request...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorTitle, { color: colors.text }]}>Authorization Error</Text>
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
          onPress={() => router.back()}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {/* App Info */}
        <View style={[styles.appCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.appName, { color: colors.text }]}>
            {sessionInfo?.appId || 'An app'}
          </Text>
          <Text style={[styles.appRequest, { color: colors.textSecondary }]}>
            wants to access your Oxy identity
          </Text>
        </View>

        {/* User Info */}
        <View style={styles.userSection}>
          <Text style={[styles.userLabel, { color: colors.textSecondary }]}>
            Signing in as:
          </Text>
          <Text style={[styles.username, { color: colors.text }]}>
            @{user.username}
          </Text>
          <Text style={[styles.publicKey, { color: colors.textSecondary }]}>
            {KeyManager.shortenPublicKey(user.publicKey || '')}
          </Text>
        </View>

        {/* Permissions */}
        <View style={[styles.permissionsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.permissionsTitle, { color: colors.text }]}>
            This will allow the app to:
          </Text>
          <View style={styles.permissionItem}>
            <Text style={styles.permissionBullet}>•</Text>
            <Text style={[styles.permissionText, { color: colors.textSecondary }]}>
              Verify your identity
            </Text>
          </View>
          <View style={styles.permissionItem}>
            <Text style={styles.permissionBullet}>•</Text>
            <Text style={[styles.permissionText, { color: colors.textSecondary }]}>
              Access your public profile information
            </Text>
          </View>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={handleAuthorize}
          disabled={isAuthorizing}
        >
          {isAuthorizing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Authorize</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
          onPress={handleDeny}
          disabled={isAuthorizing}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Deny</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
  },
  appCard: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 24,
  },
  appName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  appRequest: {
    fontSize: 14,
  },
  userSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  userLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  username: {
    fontSize: 18,
    fontWeight: '600',
  },
  publicKey: {
    fontSize: 12,
    marginTop: 4,
  },
  permissionsCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  permissionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  permissionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  permissionBullet: {
    width: 20,
    color: '#666',
  },
  permissionText: {
    flex: 1,
    fontSize: 14,
  },
  actions: {
    gap: 12,
  },
  button: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
});


