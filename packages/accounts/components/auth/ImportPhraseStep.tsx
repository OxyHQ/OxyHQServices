import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Button, KeyboardAwareScrollViewWrapper } from '@/components/ui';

interface ImportPhraseStepProps {
  phraseWords: string[];
  onWordChange: (index: number, word: string) => void;
  onPaste: (text: string) => void;
  onImport: () => void;
  error: string | null;
  isLoading: boolean;
  backgroundColor: string;
  textColor: string;
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
}: ImportPhraseStepProps) {
  const colors = useColors();
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
          backgroundColor: colors.card,
          borderColor: colors.border,
        }]}>
          {phraseWords.map((word, index) => (
            <View key={index} style={styles.wordInputContainer}>
              <Text style={[styles.wordNumber, { color: textColor, opacity: 0.6 }]}>{index + 1}</Text>
              <TextInput
                style={[styles.wordInput, {
                  color: textColor,
                  borderColor: colors.border,
                }]}
                value={word}
                onChangeText={(text) => {
                  // Detect paste: if text contains multiple words (space-separated), handle as paste
                  if (index === 0 && text.includes(' ') && text.split(/\s+/).length > 1) {
                    onPaste(text);
                  } else {
                    onWordChange(index, text);
                  }
                }}
                placeholder="word"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ))}
        </View>

        {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}

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
    fontFamily: 'Inter-SemiBold',
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

