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
import { useOxy, RecoveryPhraseService } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export default function ImportIdentityScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { importIdentity, isLoading } = useOxy();

  const [phraseWords, setPhraseWords] = useState<string[]>(new Array(12).fill(''));
  const [error, setError] = useState<string | null>(null);

  const handleWordChange = useCallback((index: number, word: string) => {
    setPhraseWords(prev => {
      const newWords = [...prev];
      newWords[index] = word.toLowerCase().trim();
      return newWords;
    });
    setError(null);
  }, []);

  const handlePaste = useCallback((text: string) => {
    // Handle pasting full phrase
    const words = text.trim().toLowerCase().split(/\s+/);
    if (words.length === 12 || words.length === 24) {
      setPhraseWords(words.slice(0, 12));
    }
  }, []);

  const handleImportPhrase = useCallback(async () => {
    const phrase = phraseWords.join(' ');

    // Validate the phrase
    if (!RecoveryPhraseService.validatePhrase(phrase)) {
      setError('Invalid recovery phrase. Please check the words and try again.');
      return;
    }

    setError(null);

    try {
      // Import identity (will auto-sync if online, or mark as unsynced if offline)
      await importIdentity(phrase);
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err.message || 'Failed to import identity');
    }
  }, [phraseWords, importIdentity, router]);

  const renderPhraseStep = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.title, { color: colors.text }]}>Import Your Identity</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Enter your 12-word recovery phrase to restore your identity.
      </Text>

      <View style={[styles.phraseGrid, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {phraseWords.map((word, index) => (
          <View key={index} style={styles.wordInputContainer}>
            <Text style={[styles.wordNumber, { color: colors.textSecondary }]}>{index + 1}</Text>
            <TextInput
              style={[styles.wordInput, { color: colors.text, borderColor: colors.border }]}
              value={word}
              onChangeText={(text) => handleWordChange(index, text)}
              onPaste={(e) => handlePaste(e.nativeEvent.text)}
              placeholder="word"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        ))}
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={handleImportPhrase}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Import Identity</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.linkButton}
        onPress={() => router.push('/(auth)/create-identity')}
      >
        <Text style={[styles.linkText, { color: colors.primary }]}>
          Create a new identity instead
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
    >
      {renderPhraseStep()}
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
    marginBottom: 32,
    lineHeight: 22,
  },
  phraseGrid: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  wordInputContainer: {
    width: '30%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  wordNumber: {
    fontSize: 12,
    width: 20,
  },
  wordInput: {
    flex: 1,
    borderBottomWidth: 1,
    paddingVertical: 4,
    fontSize: 14,
  },
  inputContainer: {
    marginBottom: 20,
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
});


