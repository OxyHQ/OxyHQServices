/**
 * Complete React Native Example: Cross-App Shared Identity
 *
 * This example shows how to implement shared authentication across multiple
 * React Native apps using iOS Keychain Groups and Android Account Manager.
 *
 * Apps that share authentication:
 * - Homiio (com.homiio.app)
 * - Mention (com.mention.app)
 * - Alia (com.alia.app)
 *
 * Setup required:
 * - iOS: Enable Keychain Sharing with group "group.com.oxy.shared"
 * - Android: Add sharedUserId="com.oxy.shared" to AndroidManifest.xml
 */

import React, { useEffect, useState, createContext, useContext } from 'react';
import { View, Text, Button, ActivityIndicator, Alert } from 'react-native';
import { OxyServices } from '@oxyhq/services';
import { KeyManager, SignatureService, RecoveryPhraseService } from '@oxyhq/services/crypto';
import type { User } from '@oxyhq/services';

// ==================== 1. Setup ====================

const oxyServices = new OxyServices({
  baseURL: 'https://api.oxy.so',
  cloudURL: 'https://cloud.oxy.so',
});

// ==================== 2. Auth Context ====================

interface AuthContextType {
  user: User | null;
  loading: boolean;
  hasIdentity: boolean;
  createIdentity: () => Promise<string[]>; // Returns recovery phrase
  importIdentity: (phrase: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasIdentity, setHasIdentity] = useState(false);

  useEffect(() => {
    initializeAuth();
  }, []);

  const initializeAuth = async () => {
    try {
      // 1. Check for shared session first (from other Oxy apps)
      const sharedSession = await KeyManager.getSharedSession();
      if (sharedSession) {
        console.log('Found shared session from another Oxy app!');
        oxyServices.setTokens(sharedSession.accessToken);

        try {
          const user = await oxyServices.getCurrentUser();
          setUser(user);
          setHasIdentity(true);
          setLoading(false);
          return;
        } catch (error) {
          console.warn('Shared session invalid, will try identity auth');
        }
      }

      // 2. Check for shared identity
      const hasShared = await KeyManager.hasSharedIdentity();
      if (hasShared) {
        console.log('Found shared identity');
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
        // 3. Check for local identity (migrate to shared)
        const hasLocal = await KeyManager.hasIdentity();
        if (hasLocal) {
          console.log('Migrating local identity to shared...');
          const migrated = await KeyManager.migrateToSharedIdentity();
          if (migrated) {
            setHasIdentity(true);
            // Try to sign in
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
      console.error('Auth initialization failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const signInWithIdentity = async (publicKey: string, isShared: boolean = true): Promise<User> => {
    // Request challenge from server
    const { challenge } = await oxyServices.requestChallenge(publicKey);

    // Sign challenge with private key
    const signature = isShared
      ? await SignatureService.signChallenge(challenge, await KeyManager.getSharedPrivateKey())
      : await SignatureService.signChallenge(challenge);

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

  const createIdentity = async (): Promise<string[]> => {
    setLoading(true);
    try {
      // Generate new identity with recovery phrase
      const { publicKey, recoveryPhrase } = await RecoveryPhraseService.generateIdentityWithRecovery();

      // Import to shared storage so all Oxy apps can use it
      await KeyManager.importSharedIdentity(
        await RecoveryPhraseService.privateKeyFromPhrase(recoveryPhrase.join(' '))
      );

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
    } catch (error) {
      console.error('Identity creation failed:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const importIdentity = async (phrase: string): Promise<void> => {
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
    } catch (error) {
      console.error('Identity import failed:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      // Logout from server
      const sharedSession = await KeyManager.getSharedSession();
      if (sharedSession) {
        await oxyServices.logoutSession(sharedSession.sessionId);
      }

      // Clear shared session (signs out from ALL Oxy apps)
      await KeyManager.clearSharedSession();

      // Clear local state
      oxyServices.clearTokens();
      setUser(null);
    } catch (error) {
      console.error('Sign out failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, hasIdentity, createIdentity, importIdentity, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// ==================== 3. Screens ====================

function WelcomeScreen() {
  const { createIdentity, importIdentity, loading } = useAuth();
  const [showImport, setShowImport] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState('');

  const handleCreateIdentity = async () => {
    try {
      const phrase = await createIdentity();

      // Show recovery phrase to user
      Alert.alert(
        'Identity Created!',
        'Save your recovery phrase:\n\n' + phrase.join(' '),
        [
          {
            text: 'I saved it',
            style: 'default',
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create identity');
    }
  };

  const handleImportIdentity = async () => {
    if (!recoveryPhrase.trim()) {
      Alert.alert('Error', 'Please enter your recovery phrase');
      return;
    }

    try {
      await importIdentity(recoveryPhrase.trim());
      Alert.alert('Success', 'Identity imported successfully!');
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to import identity');
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
        <Text>Checking for existing identity...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 10 }}>
        Welcome to Oxy
      </Text>
      <Text style={{ marginBottom: 20 }}>
        Create an identity or import from another Oxy app
      </Text>

      {!showImport ? (
        <>
          <Button title="Create New Identity" onPress={handleCreateIdentity} />
          <View style={{ height: 10 }} />
          <Button title="Import Existing Identity" onPress={() => setShowImport(true)} />
        </>
      ) : (
        <>
          <Text style={{ marginBottom: 10 }}>Enter your 12 or 24 word recovery phrase:</Text>
          <TextInput
            style={{
              borderWidth: 1,
              borderColor: '#ccc',
              padding: 10,
              marginBottom: 10,
              minHeight: 100,
            }}
            multiline
            value={recoveryPhrase}
            onChangeText={setRecoveryPhrase}
            placeholder="word1 word2 word3 ..."
          />
          <Button title="Import" onPress={handleImportIdentity} />
          <View style={{ height: 10 }} />
          <Button title="Back" onPress={() => setShowImport(false)} color="#999" />
        </>
      )}

      <Text style={{ marginTop: 30, fontSize: 12, color: '#666', textAlign: 'center' }}>
        Your identity is shared across all Oxy apps{'\n'}
        (Homiio, Mention, Alia, etc.)
      </Text>
    </View>
  );
}

function DashboardScreen() {
  const { user, signOut, loading } = useAuth();

  if (!user) return null;

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <View style={{ alignItems: 'center', marginVertical: 20 }}>
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: '#ddd',
            marginBottom: 10,
          }}
        />
        <Text style={{ fontSize: 20, fontWeight: 'bold' }}>{user.username}</Text>
        <Text style={{ color: '#666' }}>{user.email}</Text>
      </View>

      <View
        style={{
          backgroundColor: '#f0f9ff',
          padding: 15,
          borderRadius: 8,
          marginBottom: 20,
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 10 }}>
          ✅ Signed in across all Oxy apps
        </Text>
        <Text style={{ color: '#666' }}>
          Your identity is shared via {Platform.OS === 'ios' ? 'iOS Keychain' : 'Android Account Manager'}.
          Open any other Oxy app and you'll be automatically signed in!
        </Text>
      </View>

      <Button title={loading ? 'Signing out...' : 'Sign Out'} onPress={signOut} disabled={loading} />

      <View style={{ marginTop: 30 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 5 }}>
          Shared Identity Status:
        </Text>
        <Text style={{ color: '#666' }}>✅ Identity stored in shared storage</Text>
        <Text style={{ color: '#666' }}>✅ Session accessible to all Oxy apps</Text>
        <Text style={{ color: '#666' }}>✅ No re-authentication needed</Text>
      </View>
    </View>
  );
}

// ==================== 4. Main App ====================

import { TextInput, Platform } from 'react-native';

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { user, loading, hasIdentity } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!hasIdentity || !user) {
    return <WelcomeScreen />;
  }

  return <DashboardScreen />;
}

// ==================== 5. Utility Hooks ====================

/**
 * Hook to check if user is signed in via another Oxy app
 */
export function useSharedSession() {
  const [hasSharedSession, setHasSharedSession] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSharedSession = async () => {
      const session = await KeyManager.getSharedSession();
      setHasSharedSession(!!session);
      setLoading(false);
    };

    checkSharedSession();
  }, []);

  return { hasSharedSession, loading };
}

/**
 * Hook to check if shared identity exists
 */
export function useSharedIdentity() {
  const [hasSharedIdentity, setHasSharedIdentity] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSharedIdentity = async () => {
      const has = await KeyManager.hasSharedIdentity();
      setHasSharedIdentity(has);

      if (has) {
        const key = await KeyManager.getSharedPublicKey();
        setPublicKey(key);
      }

      setLoading(false);
    };

    checkSharedIdentity();
  }, []);

  return { hasSharedIdentity, publicKey, loading };
}

// Usage example:
function ExampleComponent() {
  const { hasSharedSession, loading } = useSharedSession();

  if (loading) return <ActivityIndicator />;

  if (hasSharedSession) {
    return (
      <Text>
        ✅ You're already signed in from another Oxy app! (Homiio, Mention, or Alia)
      </Text>
    );
  }

  return <Text>No shared session found. Create a new identity.</Text>;
}
