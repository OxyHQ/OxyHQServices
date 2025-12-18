import React, { useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useOxy, RecoveryPhraseService } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ImportPhraseStep } from '@/components/auth/ImportPhraseStep';
import { extractAuthErrorMessage } from '@/utils/auth/errorUtils';
import { RECOVERY_PHRASE_LENGTH } from '@/constants/auth';
import { useAuthFlowContext } from '../_authFlowContext';

/**
 * Import Identity - Phrase Screen (Index)
 * 
 * Allows user to enter recovery phrase to import identity
 */
export default function ImportIdentityPhraseScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const { importIdentity, isLoading } = useOxy();
  const { error, setAuthError } = useAuthFlowContext();

  const backgroundColor = colorScheme === 'dark' ? '#000000' : '#FFFFFF';
  const textColor = colorScheme === 'dark' ? '#FFFFFF' : '#000000';

  const [phraseWords, setPhraseWords] = useState<string[]>(new Array(RECOVERY_PHRASE_LENGTH).fill(''));

  const handleWordChange = useCallback((index: number, word: string) => {
    setPhraseWords(prev => {
      const newWords = [...prev];
      newWords[index] = word.toLowerCase().trim();
      return newWords;
    });
    setAuthError(null);
  }, [setAuthError]);

  const handlePaste = useCallback((text: string) => {
    const words = text.trim().toLowerCase().split(/\s+/);
    if (words.length === RECOVERY_PHRASE_LENGTH || words.length === 24) {
      setPhraseWords(words.slice(0, RECOVERY_PHRASE_LENGTH));
    }
  }, []);

  const handleImport = useCallback(async () => {
    const phrase = phraseWords.join(' ');

    if (!RecoveryPhraseService.validatePhrase(phrase)) {
      setAuthError('Invalid recovery phrase. Please check the words and try again.');
      return;
    }

    setAuthError(null);

    try {
      const result = await importIdentity(phrase);
      const wasOffline = !result.synced;

      // Check if offline - if so, skip username step
      if (wasOffline) {
        router.push('/(auth)/import-identity/notifications');
      } else {
        router.push('/(auth)/import-identity/username');
      }
    } catch (err: unknown) {
      setAuthError(extractAuthErrorMessage(err, 'Failed to import identity'));
    }
  }, [phraseWords, importIdentity, router, setAuthError]);

  return (
    <ImportPhraseStep
      phraseWords={phraseWords}
      onWordChange={handleWordChange}
      onPaste={handlePaste}
      onImport={handleImport}
      error={error}
      isLoading={isLoading}
      backgroundColor={backgroundColor}
      textColor={textColor}
      colorScheme={colorScheme}
    />
  );
}

