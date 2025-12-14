import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

/**
 * Auth Index Screen
 * 
 * Entry point for authentication flow.
 * Checks if device has an existing identity and routes accordingly.
 */
export default function AuthIndexScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { hasIdentity, signIn, isLoading } = useOxy();

  const [checking, setChecking] = useState(true);
  const [hasExistingIdentity, setHasExistingIdentity] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkIdentity();
  }, []);

  const checkIdentity = async () => {
    try {
      const exists = await hasIdentity();
      setHasExistingIdentity(exists);

      if (exists) {
        // Try to auto sign in
        try {
          await signIn();
          router.replace('/(tabs)');
          return;
        } catch (err) {
          // Identity exists but sign in failed - show options
          console.warn('Auto sign in failed:', err);
        }
      }
    } catch (err) {
      console.error('Error checking identity:', err);
    } finally {
      setChecking(false);
    }
  };

  const handleSignIn = async () => {
    setError(null);
    try {
      await signIn();
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    }
  };

  if (checking || isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Checking identity...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>Welcome to Oxy</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Your identity, your control.{'\n'}Secured by cryptography.
        </Text>

        {/* Self-custody badge */}
        <View style={[styles.selfCustodyBadge, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
          <Text style={[styles.selfCustodyIcon]}>🔐</Text>
          <View style={styles.selfCustodyTextContainer}>
            <Text style={[styles.selfCustodyTitle, { color: colors.primary }]}>Self-Custody Identity</Text>
            <Text style={[styles.selfCustodyText, { color: colors.textSecondary }]}>
              You own your keys. No passwords. No central authority.
            </Text>
          </View>
        </View>

        {hasExistingIdentity ? (
          <>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={handleSignIn}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </TouchableOpacity>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <TouchableOpacity
              style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
              onPress={() => router.push('/(auth)/import-identity')}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                Use Different Identity
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={() => router.push('/(auth)/create-identity')}
            >
              <Text style={styles.buttonText}>Create New Identity</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
              onPress={() => router.push('/(auth)/import-identity')}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                I Have a Recovery Phrase
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.footerFeatures}>
          <View style={styles.footerFeature}>
            <Text style={styles.footerIcon}>🔑</Text>
            <Text style={[styles.footerFeatureText, { color: colors.textSecondary }]}>
              Private key stays on device
            </Text>
          </View>
          <View style={styles.footerFeature}>
            <Text style={styles.footerIcon}>✍️</Text>
            <Text style={[styles.footerFeatureText, { color: colors.textSecondary }]}>
              Sign in with cryptographic proof
            </Text>
          </View>
          <View style={styles.footerFeature}>
            <Text style={styles.footerIcon}>🌐</Text>
            <Text style={[styles.footerFeatureText, { color: colors.textSecondary }]}>
              One identity for all Oxy apps
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  selfCustodyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 32,
  },
  selfCustodyIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  selfCustodyTextContainer: {
    flex: 1,
  },
  selfCustodyTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  selfCustodyText: {
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButton: {},
  secondaryButton: {
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorText: {
    color: '#DC3545',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  footer: {
    padding: 20,
    paddingBottom: 40,
  },
  footerFeatures: {
    gap: 12,
  },
  footerFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  footerFeatureText: {
    fontSize: 13,
  },
});


