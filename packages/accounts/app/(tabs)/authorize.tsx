import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useAlert, Button } from '@/components/ui';
import { IdentityCard } from '@/components/identity';

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
  const alert = useAlert();
  const { oxyServices, user, isAuthenticated, activeSessionId } = useOxy();

  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{
    appId: string;
    expiresAt: string;
  } | null>(null);

  const loadSessionInfo = useCallback(async () => {
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
  }, [params.token, oxyServices]);

  // Load session info
  useEffect(() => {
    loadSessionInfo();
  }, [params.token, loadSessionInfo]);

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

      alert(
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
  }, [params.token, activeSessionId, oxyServices, sessionInfo, router, alert]);

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

  // Get user display name
  const displayName = useMemo(() => {
    if (user?.name?.full) return user.name.full;
    if (user?.name?.first) return user.name.first;
    if (user?.username) return user.username;
    return 'User';
  }, [user]);

  // Get avatar URL
  const avatarUrl = useMemo(() => {
    if (user?.avatar && oxyServices) {
      return oxyServices.getFileDownloadUrl(user.avatar, 'thumb');
    }
    return undefined;
  }, [user?.avatar, oxyServices]);

  // Memoize colors for all states
  const backgroundColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.background : Colors.light.background),
    [colorScheme]
  );
  const textColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.text : Colors.light.text),
    [colorScheme]
  );

  // Check if user is authenticated
  if (!isAuthenticated || !user) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor }]}>
        <View style={styles.content}>
          <MaterialCommunityIcons name="lock-outline" size={48} color={textColor} />
          <Text style={[styles.title, { color: textColor }]}>Sign In Required</Text>
          <Text style={[styles.subtitle, { color: textColor, opacity: 0.8 }]}>
            You need to be signed in to authorize this request.
          </Text>
          <Button
            variant="primary"
            onPress={() => router.push('/(auth)')}
            style={styles.fullWidthButton}
          >
            Sign In
          </Button>
        </View>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor }]}>
        <View style={styles.content}>
          <ActivityIndicator size="large" color={textColor} />
          <Text style={[styles.loadingText, { color: textColor, opacity: 0.8 }]}>
            Loading authorization request...
          </Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor }]}>
        <View style={styles.content}>
          <MaterialCommunityIcons name="alert-circle-outline" size={48} color="#FF3B30" />
          <Text style={[styles.title, { color: textColor }]}>Authorization Error</Text>
          <Text style={[styles.errorText, { color: textColor, opacity: 0.8 }]}>{error}</Text>
          <Button
            variant="secondary"
            onPress={() => router.back()}
            style={styles.fullWidthButton}
          >
            Go Back
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          {/* App Icon/Name Section */}
          <View style={styles.appHeader}>
            <MaterialCommunityIcons
              name="application"
              size={64}
              color={textColor}
            />
            <Text style={[styles.appName, { color: textColor }]}>
              {sessionInfo?.appId || 'An app'}
            </Text>
            <Text style={[styles.appRequest, { color: textColor, opacity: 0.8 }]}>
              wants to access your account
            </Text>
          </View>

          {/* Identity Card */}
          <View style={styles.identityCardContainer}>
            <IdentityCard
              displayName={displayName}
              username={user?.username}
              avatarUrl={avatarUrl}
              accountCreated={user?.createdAt}
              publicKey={user?.publicKey}
            />
          </View>

          {/* Permissions Section */}
          <View style={styles.permissionsSection}>
            <View style={styles.permissionsHeader}>
              <MaterialCommunityIcons
                name="shield-check-outline"
                size={20}
                color={textColor}
              />
              <Text style={[styles.permissionsTitle, { color: textColor }]}>
                This app will be able to:
              </Text>
            </View>
            <View style={styles.permissionsList}>
              <View style={styles.permissionItem}>
                <Ionicons name="checkmark-circle" size={20} color={textColor} />
                <Text style={[styles.permissionText, { color: textColor, opacity: 0.8 }]}>
                  Verify your identity
                </Text>
              </View>
              <View style={styles.permissionItem}>
                <Ionicons name="checkmark-circle" size={20} color={textColor} />
                <Text style={[styles.permissionText, { color: textColor, opacity: 0.8 }]}>
                  Access your public profile information
                </Text>
              </View>
            </View>
          </View>

        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.footer}>
        <Button
          variant="secondary"
          onPress={handleDeny}
          disabled={isAuthorizing}
          style={styles.button}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onPress={handleAuthorize}
          disabled={isAuthorizing}
          loading={isAuthorizing}
          style={styles.button}
        >
          Continue
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 42,
    fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 12,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  appHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  appName: {
    fontSize: 42,
    fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
    marginTop: 20,
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: -1,
  },
  appRequest: {
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 24,
  },
  identityCardContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  permissionsSection: {
    marginBottom: 24,
  },
  permissionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  permissionsTitle: {
    fontSize: 18,
    fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-SemiBold',
    fontWeight: Platform.OS === 'web' ? '600' : undefined,
    marginLeft: 8,
    letterSpacing: -0.5,
  },
  permissionsList: {
    gap: 12,
  },
  permissionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  permissionText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    padding: 42,
    paddingBottom: 60,
    gap: 12,
  },
  button: {
    flex: 1,
  },
  fullWidthButton: {
    width: '100%',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 24,
  },
  errorText: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
    paddingHorizontal: 16,
  },
});

