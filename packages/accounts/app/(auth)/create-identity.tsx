import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useAlert } from '@/components/ui';

type Step = 'intro' | 'recovery' | 'confirm';

export default function CreateIdentityScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const alert = useAlert();
  const { createIdentity, signIn, isLoading } = useOxy();

  const [step, setStep] = useState<Step>('intro');
  const [recoveryPhrase, setRecoveryPhrase] = useState<string[]>([]);
  const [confirmWords, setConfirmWords] = useState<{ index: number; word: string }[]>([]);
  const [userConfirmation, setUserConfirmation] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleCreateIdentity = useCallback(async () => {
    setError(null);

    try {
      const result = await createIdentity();
      setRecoveryPhrase(result.recoveryPhrase);
      setIsOffline(!result.synced);

      // Select 3 random words to confirm
      const indices: number[] = [];
      while (indices.length < 3) {
        const idx = Math.floor(Math.random() * result.recoveryPhrase.length);
        if (!indices.includes(idx)) {
          indices.push(idx);
        }
      }
      indices.sort((a, b) => a - b);
      setConfirmWords(indices.map(idx => ({ index: idx, word: result.recoveryPhrase[idx] })));
      setUserConfirmation(new Array(3).fill(''));

      setStep('recovery');
    } catch (err: any) {
      setError(err.message || 'Failed to create identity');
    }
  }, [createIdentity]);

  const handleContinueToConfirm = useCallback(() => {
    alert(
      'Have you saved your recovery phrase?',
      'You will need it to recover your account if you lose access to this device. This is the ONLY time you will see it.',
      [
        { text: 'Go Back', style: 'cancel' },
        { text: 'I saved it', onPress: () => setStep('confirm') },
      ]
    );
  }, [alert]);

  const handleConfirmPhrase = useCallback(async () => {
    const isCorrect = confirmWords.every(
      (item, idx) => userConfirmation[idx]?.toLowerCase().trim() === item.word.toLowerCase()
    );

    if (!isCorrect) {
      setError('The words you entered do not match. Please check your recovery phrase.');
      return;
    }

    // Phrase confirmed - now sign in (works offline)
    setIsSigningIn(true);
    setError(null);

    try {
      // Sign in (works offline - will create local session if offline)
      await signIn();

      // Successfully signed in - navigate to main app
      if (isOffline) {
        // Show offline success message
        alert(
          'Identity Created (Offline)',
          'Your identity has been created and saved locally. When you connect to the internet, it will automatically sync with Oxy servers.',
          [{ text: 'OK', onPress: () => router.replace('/(tabs)') }]
        );
      } else {
        // Online - navigate directly
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to sign in. Please try again.';
      setError(errorMessage);
      console.error('Sign-in error:', err);
    } finally {
      setIsSigningIn(false);
    }
  }, [confirmWords, userConfirmation, router, isOffline, signIn, alert]);

  const renderIntroStep = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.title, { color: colors.text }]}>Create Your Identity</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Your identity is self-custody. You hold the keys, not us.
      </Text>

      {/* How it works info */}
      <View style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.infoTitle, { color: colors.text }]}>🔐 How Self-Custody Works</Text>
        <Text style={[styles.infoText, { color: colors.textSecondary }]}>
          • A unique cryptographic key pair is generated on your device{'\n'}
          • Your private key never leaves this device{'\n'}
          • Your public key becomes your identity across all Oxy apps{'\n'}
          • No passwords to remember or get hacked{'\n'}
          • Profile information (username, name, etc.) can be added later
        </Text>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={handleCreateIdentity}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Generate My Keys</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.linkButton}
        onPress={() => router.push('/(auth)/import-identity')}
      >
        <Text style={[styles.linkText, { color: colors.primary }]}>
          I already have a recovery phrase
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderRecoveryStep = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.title, { color: colors.text }]}>Your Recovery Phrase</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        These 12 words are the master key to your identity. Write them down and store them safely offline.
      </Text>

      {/* Offline notice */}
      {isOffline && (
        <View style={[styles.offlineNotice, { backgroundColor: '#E0F2FE', borderColor: '#7DD3FC' }]}>
          <Text style={[styles.offlineNoticeText, { color: '#0369A1' }]}>
            📱 Created Offline — Your identity was created locally. It will sync automatically when you connect to the internet.
          </Text>
        </View>
      )}

      <View style={[styles.phraseContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {recoveryPhrase.map((word, index) => (
          <View key={index} style={styles.wordItem}>
            <Text style={[styles.wordNumber, { color: colors.textSecondary }]}>{index + 1}</Text>
            <Text style={[styles.word, { color: colors.text }]}>{word}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.warningBox, { backgroundColor: '#FFF3CD', borderColor: '#FFE69C' }]}>
        <Text style={styles.warningText}>
          ⚠️ Self-Custody Warning
        </Text>
        <Text style={[styles.warningText, { marginTop: 8 }]}>
          • This is the ONLY way to recover your identity{'\n'}
          • Never share these words with anyone{'\n'}
          • Oxy cannot recover your account without this phrase{'\n'}
          • Store it offline in a secure location
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={handleContinueToConfirm}
      >
        <Text style={styles.buttonText}>I've Saved My Phrase Securely</Text>
      </TouchableOpacity>
    </View>
  );

  const renderConfirmStep = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.title, { color: colors.text }]}>Confirm Your Phrase</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Enter the following words from your recovery phrase to confirm you saved it.
      </Text>

      {confirmWords.map((item, idx) => (
        <View key={item.index} style={styles.inputContainer}>
          <Text style={[styles.label, { color: colors.text }]}>Word #{item.index + 1}</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            placeholder={`Enter word #${item.index + 1}`}
            placeholderTextColor={colors.textSecondary}
            value={userConfirmation[idx]}
            onChangeText={(text) => {
              const newConfirmation = [...userConfirmation];
              newConfirmation[idx] = text;
              setUserConfirmation(newConfirmation);
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ))}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={handleConfirmPhrase}
        disabled={isSigningIn}
      >
        {isSigningIn ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Confirm & Continue</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.linkButton}
        onPress={() => setStep('recovery')}
      >
        <Text style={[styles.linkText, { color: colors.primary }]}>
          Go back to see the phrase
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
    >
      {step === 'intro' && renderIntroStep()}
      {step === 'recovery' && renderRecoveryStep()}
      {step === 'confirm' && renderConfirmStep()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingTop: 40,
  },
  stepContainer: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 20,
    lineHeight: 22,
  },
  infoBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 22,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputHint: {
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
  },
  button: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    padding: 16,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 16,
  },
  errorText: {
    color: '#DC3545',
    fontSize: 14,
    marginTop: 8,
  },
  phraseContainer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  wordItem: {
    width: '30%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  wordNumber: {
    fontSize: 12,
    width: 20,
  },
  word: {
    fontSize: 14,
    fontWeight: '500',
  },
  warningBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  warningText: {
    color: '#856404',
    fontSize: 14,
    lineHeight: 20,
  },
  offlineNotice: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  offlineNoticeText: {
    fontSize: 14,
    lineHeight: 20,
  },
});


