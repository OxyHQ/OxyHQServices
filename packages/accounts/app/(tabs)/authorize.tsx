import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useOxy, KeyManager } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { UserAvatar } from '@/components/user-avatar';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';

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

  // Check if user is authenticated
  if (!isAuthenticated || !user) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
          <View style={[styles.iconContainer, { backgroundColor: colors.card }]}>
            <MaterialCommunityIcons name="lock-outline" size={48} color={colors.tint} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Sign In Required</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            You need to be signed in to authorize this request.
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.tint }]}
            onPress={() => router.push('/(auth)')}
          >
            <Text style={styles.primaryButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScreenContentWrapper>
    );
  }

  if (isLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading authorization request...
          </Text>
        </View>
      </ScreenContentWrapper>
    );
  }

  if (error) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
          <View style={[styles.iconContainer, styles.errorIcon, { backgroundColor: colors.card }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={48} color="#FF3B30" />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Authorization Error</Text>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: colors.border }]}
            onPress={() => router.back()}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </ScreenContentWrapper>
    );
  }

  return (
    <ScreenContentWrapper>
      <ScrollView 
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          {/* App Icon/Name Section */}
          <View style={styles.appHeader}>
            <View style={[styles.appIconContainer, { backgroundColor: colors.card }]}>
              <MaterialCommunityIcons 
                name="application" 
                size={64} 
                color={colors.tint} 
              />
            </View>
            <Text style={[styles.appName, { color: colors.text }]}>
              {sessionInfo?.appId || 'An app'}
            </Text>
            <Text style={[styles.appRequest, { color: colors.textSecondary }]}>
              wants to access your account
            </Text>
          </View>

          {/* User Profile Section */}
          <View style={[styles.userCard, { backgroundColor: colors.card }]}>
            <View style={styles.userInfo}>
              <UserAvatar
                name={displayName}
                imageUrl={avatarUrl}
                size={64}
              />
              <View style={styles.userDetails}>
                <Text style={[styles.userLabel, { color: colors.textSecondary }]}>
                  Signing in as
                </Text>
                <Text style={[styles.username, { color: colors.text }]}>
                  {user.username ? `@${user.username}` : displayName}
                </Text>
                <Text style={[styles.publicKey, { color: colors.textSecondary }]}>
                  {KeyManager.shortenPublicKey(user.publicKey || '')}
                </Text>
              </View>
            </View>
          </View>

          {/* Permissions Section */}
          <View style={[styles.permissionsCard, { backgroundColor: colors.card }]}>
            <View style={styles.permissionsHeader}>
              <MaterialCommunityIcons 
                name="shield-check-outline" 
                size={20} 
                color={colors.tint} 
              />
              <Text style={[styles.permissionsTitle, { color: colors.text }]}>
                This app will be able to:
              </Text>
            </View>
            <View style={styles.permissionsList}>
              <View style={styles.permissionItem}>
                <Ionicons name="checkmark-circle" size={20} color={colors.tint} />
                <Text style={[styles.permissionText, { color: colors.text }]}>
                  Verify your identity
                </Text>
              </View>
              <View style={styles.permissionItem}>
                <Ionicons name="checkmark-circle" size={20} color={colors.tint} />
                <Text style={[styles.permissionText, { color: colors.text }]}>
                  Access your public profile information
                </Text>
              </View>
            </View>
          </View>

          {/* Security Notice */}
          <View style={[styles.securityNotice, { backgroundColor: colors.card }]}>
            <MaterialCommunityIcons name="lock-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.securityText, { color: colors.textSecondary }]}>
              Your password will not be shared with this app
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={[styles.actionsContainer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: colors.border }]}
          onPress={handleDeny}
          disabled={isAuthorizing}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.tint }]}
          onPress={handleAuthorize}
          disabled={isAuthorizing}
        >
          {isAuthorizing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 100,
  },
  container: {
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
    paddingHorizontal: 24,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  errorIcon: {
    backgroundColor: '#FF3B3015',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  appHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  appIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  appName: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  appRequest: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  userCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userDetails: {
    flex: 1,
    marginLeft: 16,
  },
  userLabel: {
    fontSize: 13,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '500',
  },
  username: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  publicKey: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  permissionsCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  permissionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  permissionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    letterSpacing: -0.2,
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
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  securityText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    minHeight: 52,
    backgroundColor: 'transparent',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
    paddingHorizontal: 16,
  },
});






