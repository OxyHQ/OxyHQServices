/**
 * Expo 54 Universal Authentication Example
 *
 * This example works on iOS, Android, AND Web with the SAME code!
 *
 * Platform-specific behavior:
 * - iOS/Android: Uses shared Keychain/Account Manager + cryptographic identity
 * - Web: Uses CrossDomainAuth (FedCM/Popup/Redirect)
 *
 * Setup required:
 * 1. iOS: Enable Keychain Sharing with group "group.com.oxy.shared"
 * 2. Android: Add sharedUserId="com.oxy.shared" to AndroidManifest.xml
 * 3. Web: Deploy auth.oxy.so server
 */

import React, { useEffect, useState, createContext, useContext } from 'react';
import { View, Text, Button, ActivityIndicator, Platform, TextInput, Alert, StyleSheet } from 'react-native';
import { OxyServices } from '@oxyhq/services';
import { createCrossDomainAuth, type CrossDomainAuth } from '@oxyhq/services/core';
import type { User } from '@oxyhq/services';

// Import crypto modules - these are native-only, so we'll conditionally import
let KeyManager: any = null;
let SignatureService: any = null;
let RecoveryPhraseService: any = null;

// Only import crypto on native platforms
if (Platform.OS !== 'web') {
  KeyManager = require('@oxyhq/services/crypto').KeyManager;
  SignatureService = require('@oxyhq/services/crypto').SignatureService;
  RecoveryPhraseService = require('@oxyhq/services/crypto').RecoveryPhraseService;
}

// ==================== 1. Platform Detection ====================

/**
 * Check if running on native platform (iOS/Android)
 */
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * Check if running on web
 */
const isWeb = Platform.OS === 'web';

// ==================== 2. Setup ====================

const oxyServices = new OxyServices({
  baseURL: 'https://api.oxy.so',
  cloudURL: 'https://cloud.oxy.so',
});

// Create cross-domain auth (only used on web)
const crossDomainAuth = isWeb ? createCrossDomainAuth(oxyServices) : null;

// ==================== 3. Universal Auth Context ====================

interface AuthContextType {
  user: User | null;
  loading: boolean;
  platform: 'ios' | 'android' | 'web';

  // Universal methods (work on all platforms)
  signOut: () => Promise<void>;

  // Native-only methods
  hasIdentity?: boolean;
  createIdentity?: () => Promise<string[]>;
  importIdentity?: (phrase: string) => Promise<void>;

  // Web-only methods
  signInWeb?: () => Promise<void>;
  crossDomainAuth?: CrossDomainAuth;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function UniversalAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasIdentity, setHasIdentity] = useState(false);

  useEffect(() => {
    initializeAuth();
  }, []);

  // ==================== Native Auth (iOS/Android) ====================

  const initializeNativeAuth = async () => {
    if (!KeyManager) return;

    try {
      // 1. Check for shared session first (from other Oxy apps)
      const sharedSession = await KeyManager.getSharedSession();
      if (sharedSession) {
        console.log(`[${Platform.OS}] Found shared session from another Oxy app!`);
        oxyServices.setTokens(sharedSession.accessToken);

        try {
          const user = await oxyServices.getCurrentUser();
          setUser(user);
          setHasIdentity(true);
          setLoading(false);
          return;
        } catch (error) {
          console.warn('Shared session invalid');
        }
      }

      // 2. Check for shared identity
      const hasShared = await KeyManager.hasSharedIdentity();
      if (hasShared) {
        console.log(`[${Platform.OS}] Found shared identity`);
        setHasIdentity(true);

        // Try to sign in with shared identity
        const publicKey = await KeyManager.getSharedPublicKey();
        if (publicKey) {
          try {
            const user = await signInWithIdentity(publicKey, true);
            setUser(user);
          } catch (error) {
            console.error('Auto sign-in failed:', error);
          }
        }
      } else {
        // 3. Migrate local identity to shared (for existing users)
        const hasLocal = await KeyManager.hasIdentity();
        if (hasLocal) {
          console.log(`[${Platform.OS}] Migrating local identity to shared...`);
          const migrated = await KeyManager.migrateToSharedIdentity();
          if (migrated) {
            setHasIdentity(true);
            const publicKey = await KeyManager.getSharedPublicKey();
            if (publicKey) {
              try {
                const user = await signInWithIdentity(publicKey, true);
                setUser(user);
              } catch (error) {
                console.error('Auto sign-in after migration failed:', error);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`[${Platform.OS}] Auth initialization failed:`, error);
    } finally {
      setLoading(false);
    }
  };

  const signInWithIdentity = async (publicKey: string, isShared: boolean = true): Promise<User> => {
    if (!SignatureService) throw new Error('SignatureService not available on web');

    // Request challenge from server
    const { challenge } = await oxyServices.requestChallenge(publicKey);

    // Sign challenge with private key
    const privateKey = isShared
      ? await KeyManager.getSharedPrivateKey()
      : await KeyManager.getPrivateKey();
    const signature = await SignatureService.signChallenge(challenge, privateKey);

    // Verify challenge and get session
    const session = await oxyServices.verifyChallenge(
      publicKey,
      challenge,
      signature,
      Date.now()
    );

    // Store session in shared storage for other apps
    await KeyManager.storeSharedSession(session.sessionId, session.accessToken || '');

    // Set access token
    oxyServices.setTokens(session.accessToken || '');

    return session.user;
  };

  const createNativeIdentity = async (): Promise<string[]> => {
    if (!RecoveryPhraseService) throw new Error('RecoveryPhraseService not available on web');

    setLoading(true);
    try {
      // Generate new identity with recovery phrase
      const { publicKey, recoveryPhrase } = await RecoveryPhraseService.generateIdentityWithRecovery();

      // Import to shared storage so all Oxy apps can use it
      const privateKey = await RecoveryPhraseService.privateKeyFromPhrase(recoveryPhrase.join(' '));
      await KeyManager.importSharedIdentity(privateKey);

      // Register with server
      const signature = await SignatureService.createRegistrationSignature(
        await KeyManager.getSharedPrivateKey()
      );
      await oxyServices.register(publicKey, signature, Date.now());

      // Sign in
      const user = await signInWithIdentity(publicKey, true);

      setUser(user);
      setHasIdentity(true);

      return recoveryPhrase;
    } finally {
      setLoading(false);
    }
  };

  const importNativeIdentity = async (phrase: string): Promise<void> => {
    if (!RecoveryPhraseService) throw new Error('RecoveryPhraseService not available on web');

    setLoading(true);
    try {
      // Convert phrase to private key
      const privateKey = await RecoveryPhraseService.privateKeyFromPhrase(phrase);

      // Import to shared storage
      const publicKey = await KeyManager.importSharedIdentity(privateKey);

      // Check if already registered
      const { registered } = await oxyServices.checkPublicKeyRegistered(publicKey);

      if (!registered) {
        // Register with server
        const signature = await SignatureService.createRegistrationSignature(privateKey);
        await oxyServices.register(publicKey, signature, Date.now());
      }

      // Sign in
      const user = await signInWithIdentity(publicKey, true);

      setUser(user);
      setHasIdentity(true);
    } finally {
      setLoading(false);
    }
  };

  // ==================== Web Auth ====================

  const initializeWebAuth = async () => {
    if (!crossDomainAuth) return;

    try {
      console.log('[web] Initializing cross-domain auth...');

      // This handles:
      // 1. Redirect callbacks
      // 2. Stored sessions
      // 3. Silent SSO check
      const session = await crossDomainAuth.initialize();

      if (session) {
        console.log('[web] User authenticated via SSO:', session.user?.username);
        setUser(session.user);
      } else {
        console.log('[web] No existing session found');
      }
    } catch (error) {
      console.error('[web] Auth initialization failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const signInWeb = async () => {
    if (!crossDomainAuth) return;

    setLoading(true);
    try {
      // Auto-selects best method: FedCM → Popup → Redirect
      const session = await crossDomainAuth.signIn({
        method: 'auto',
        onMethodSelected: (method) => {
          console.log(`[web] Authenticating with: ${method}`);
        },
      });

      if (session) {
        setUser(session.user);
      }
    } catch (error) {
      console.error('[web] Sign in failed:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // ==================== Universal Methods ====================

  const initializeAuth = async () => {
    if (isNative) {
      await initializeNativeAuth();
    } else {
      await initializeWebAuth();
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      if (isNative && KeyManager) {
        // Native: Clear shared session (signs out from ALL Oxy apps)
        const sharedSession = await KeyManager.getSharedSession();
        if (sharedSession) {
          await oxyServices.logoutSession(sharedSession.sessionId);
        }
        await KeyManager.clearSharedSession();
      } else if (isWeb) {
        // Web: Logout and clear stored session
        const sessionId = (oxyServices as any).getStoredSessionId?.();
        if (sessionId) {
          await oxyServices.logoutSession(sessionId);
        }
        (oxyServices as any).clearStoredSession?.();
      }

      oxyServices.clearTokens();
      setUser(null);
    } catch (error) {
      console.error('Sign out failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const contextValue: AuthContextType = {
    user,
    loading,
    platform: Platform.OS as 'ios' | 'android' | 'web',
    signOut,
    // Native-only
    ...(isNative && {
      hasIdentity,
      createIdentity: createNativeIdentity,
      importIdentity: importNativeIdentity,
    }),
    // Web-only
    ...(isWeb && {
      signInWeb,
      crossDomainAuth: crossDomainAuth || undefined,
    }),
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within UniversalAuthProvider');
  }
  return context;
}

// ==================== 4. Universal UI Components ====================

function WelcomeScreen() {
  const { platform, createIdentity, importIdentity, signInWeb, loading } = useAuth();
  const [showImport, setShowImport] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState('');

  // Native: Identity creation flow
  const handleCreateIdentity = async () => {
    if (!createIdentity) return;

    try {
      const phrase = await createIdentity();

      Alert.alert(
        '✅ Identity Created!',
        `Save your recovery phrase:\n\n${phrase.join(' ')}\n\nThis phrase can be used to sign in from any Oxy app!`,
        [{ text: 'I saved it', style: 'default' }]
      );
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create identity');
    }
  };

  const handleImportIdentity = async () => {
    if (!importIdentity || !recoveryPhrase.trim()) {
      Alert.alert('Error', 'Please enter your recovery phrase');
      return;
    }

    try {
      await importIdentity(recoveryPhrase.trim());
      Alert.alert('✅ Success', 'Identity imported successfully!');
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to import identity');
    }
  };

  // Web: Cross-domain sign in
  const handleWebSignIn = async () => {
    if (!signInWeb) return;

    try {
      await signInWeb();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Sign in failed');
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>
          Checking for existing {platform === 'web' ? 'session' : 'identity'}...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Oxy</Text>

      <View style={styles.platformBadge}>
        <Text style={styles.platformText}>
          {platform === 'web' ? '🌐 Web' : platform === 'ios' ? '🍎 iOS' : '🤖 Android'}
        </Text>
      </View>

      {/* Native: Identity creation/import */}
      {isNative && !showImport && (
        <>
          <Text style={styles.subtitle}>
            Create a new identity or import from another Oxy app
          </Text>
          <Button title="Create New Identity" onPress={handleCreateIdentity} />
          <View style={styles.spacer} />
          <Button title="Import Existing Identity" onPress={() => setShowImport(true)} />
        </>
      )}

      {/* Native: Import flow */}
      {isNative && showImport && (
        <>
          <Text style={styles.subtitle}>Enter your 12 or 24 word recovery phrase:</Text>
          <TextInput
            style={styles.textArea}
            multiline
            value={recoveryPhrase}
            onChangeText={setRecoveryPhrase}
            placeholder="word1 word2 word3 ..."
            placeholderTextColor="#999"
          />
          <Button title="Import" onPress={handleImportIdentity} />
          <View style={styles.spacer} />
          <Button title="Back" onPress={() => setShowImport(false)} color="#999" />
        </>
      )}

      {/* Web: Simple sign in button */}
      {isWeb && (
        <>
          <Text style={styles.subtitle}>
            Sign in once, access all Oxy apps across all domains
          </Text>
          <Button title="Sign in with Oxy" onPress={handleWebSignIn} />
          <Text style={styles.hint}>
            Works across homiio.com, mention.earth, alia.onl, etc.
          </Text>
        </>
      )}

      <Text style={styles.footer}>
        {isNative
          ? `Your identity is shared across all Oxy apps on ${platform}`
          : 'Using modern browser-native authentication (no third-party cookies)'}
      </Text>
    </View>
  );
}

function DashboardScreen() {
  const { user, signOut, loading, platform } = useAuth();

  if (!user) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <View style={styles.avatar} />
          <View>
            <Text style={styles.username}>{user.username}</Text>
            <Text style={styles.email}>{user.email}</Text>
          </View>
        </View>

        <Button title={loading ? 'Signing out...' : 'Sign Out'} onPress={signOut} disabled={loading} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>✅ You're signed in!</Text>
        <Text style={styles.cardText}>
          {isNative
            ? `Your session is shared via ${platform === 'ios' ? 'iOS Keychain' : 'Android Account Manager'}. Open any other Oxy app and you'll be automatically signed in!`
            : 'Open any other Oxy app (homiio.com, mention.earth, etc.) in this browser and you\'ll be automatically signed in. No need to sign in again!'}
        </Text>
      </View>

      <View style={styles.statusList}>
        <Text style={styles.statusTitle}>Authentication Status:</Text>
        {isNative ? (
          <>
            <Text style={styles.statusItem}>✅ Identity stored in shared storage</Text>
            <Text style={styles.statusItem}>✅ Session accessible to all Oxy apps</Text>
            <Text style={styles.statusItem}>✅ Works offline (cryptographic auth)</Text>
            <Text style={styles.statusItem}>✅ No passwords needed</Text>
          </>
        ) : (
          <>
            <Text style={styles.statusItem}>✅ Authenticated across all Oxy domains</Text>
            <Text style={styles.statusItem}>✅ No third-party cookies required</Text>
            <Text style={styles.statusItem}>✅ Privacy-preserving identity</Text>
            <Text style={styles.statusItem}>✅ Browser-native security</Text>
          </>
        )}
      </View>
    </View>
  );
}

// ==================== 5. Main App ====================

export default function App() {
  return (
    <UniversalAuthProvider>
      <AppContent />
    </UniversalAuthProvider>
  );
}

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return user ? <DashboardScreen /> : <WelcomeScreen />;
}

// ==================== 6. Styles ====================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  platformBadge: {
    alignSelf: 'center',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 20,
  },
  platformText: {
    fontSize: 12,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  textArea: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    marginBottom: 10,
    minHeight: 100,
    borderRadius: 8,
    textAlignVertical: 'top',
  },
  spacer: {
    height: 10,
  },
  hint: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 10,
  },
  footer: {
    marginTop: 30,
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  header: {
    marginBottom: 20,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#ddd',
    marginRight: 15,
  },
  username: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  email: {
    fontSize: 14,
    color: '#666',
  },
  card: {
    backgroundColor: '#f0f9ff',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  cardText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  statusList: {
    marginTop: 10,
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  statusItem: {
    fontSize: 14,
    color: '#666',
    marginBottom: 3,
  },
});
