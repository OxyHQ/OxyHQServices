import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, KeyboardAwareScrollViewWrapper } from '@/components/ui';
import { RECOVERY_PHRASE_LENGTH, RECOVERY_PHRASE_24_LENGTH } from '@/constants/auth';

interface ImportPhraseStepProps {
  phraseWords: string[];
  onWordChange: (index: number, word: string) => void;
  onPaste: (text: string) => void;
  onImport: () => void;
  error: string | null;
  isLoading: boolean;
  backgroundColor: string;
  textColor: string;
  colorScheme: 'light' | 'dark';
}

/**
 * Import phrase step component for entering recovery phrase
 */
export function ImportPhraseStep({
  phraseWords,
  onWordChange,
  onPaste,
  onImport,
  error,
  isLoading,
  backgroundColor,
  textColor,
  colorScheme,
}: ImportPhraseStepProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor, paddingTop: insets.top }]}>
      <KeyboardAwareScrollViewWrapper
        contentContainerStyle={[styles.scrollContent, styles.stepContainer]}
      >
        <Text style={[styles.title, { color: textColor }]}>Import Your Identity</Text>
        <Text style={[styles.subtitle, { color: textColor, opacity: 0.6 }]}>
          Enter your 12-word recovery phrase to restore your identity.
        </Text>

        <View style={[styles.phraseGrid, {
          backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F5',
          borderColor: colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0'
        }]}>
          {phraseWords.map((word, index) => (
            <View key={index} style={styles.wordInputContainer}>
              <Text style={[styles.wordNumber, { color: textColor, opacity: 0.6 }]}>{index + 1}</Text>
              <TextInput
                style={[styles.wordInput, {
                  color: textColor,
                  borderColor: colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0'
                }]}
                value={word}
                onChangeText={(text) => onWordChange(index, text)}
                onPaste={(e) => onPaste(e.nativeEvent.text)}
                placeholder="word"
                placeholderTextColor={colorScheme === 'dark' ? '#8E8E93' : '#8E8E93'}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ))}
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Button
          variant="primary"
          onPress={onImport}
          disabled={isLoading}
          loading={isLoading}
          style={styles.primaryButton}
        >
          Import Identity
        </Button>

        <Button
          variant="ghost"
          onPress={() => router.push('/(auth)/create-identity')}
        >
          Create a new identity instead
        </Button>
      </KeyboardAwareScrollViewWrapper>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 60,
  },
  stepContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 38,
    fontFamily: 'Phudu-SemiBold',
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 32,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 32,
  },
  errorText: {
    color: '#DC3545',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
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
});

