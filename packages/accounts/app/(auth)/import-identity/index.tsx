import React, { useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { RecoveryPhraseService, IdentityAlreadyExistsError } from '@oxyhq/core';
import { useColors } from '@/hooks/useColors';
import { ImportPhraseStep } from '@/components/auth/ImportPhraseStep';
import { extractAuthErrorMessage } from '@/utils/auth/errorUtils';
import { RECOVERY_PHRASE_LENGTH } from '@/constants/auth';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import { useIdentity } from '@/hooks/useIdentity';
import { useIdentityStore } from '@/hooks/identity/identityStore';

/**
 * Import Identity - Phrase Screen (Index)
 *
 * Allows user to enter recovery phrase to import identity
 */
export default function ImportIdentityPhraseScreen() {
  const router = useRouter();
  const colors = useColors();
  const { importIdentity } = useIdentity();
  const { error, setAuthError } = useAuthFlowContext();
  const setRecoveryPhraseAcknowledgedPersisted = useIdentityStore(
    (state) => state.setRecoveryPhraseAcknowledged,
  );
  const [isLoading, setIsLoading] = useState(false);

  const backgroundColor = colors.background;
  const textColor = colors.text;

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
    setIsLoading(true);

    try {
      const result = await importIdentity(phrase);
      const wasOffline = !result.synced;

      // The user just typed the phrase by hand, so they unambiguously
      // already have it written down somewhere. Mark it as acknowledged
      // so the security screen doesn't nag them about a backup they
      // already possess.
      setRecoveryPhraseAcknowledgedPersisted(true);

      // Check if offline - if so, skip username step
      if (wasOffline) {
        router.replace('/(auth)/import-identity/notifications');
      } else {
        router.replace('/(auth)/import-identity/username');
      }
    } catch (err: unknown) {
      if (err instanceof IdentityAlreadyExistsError) {
        // The user is trying to import a different identity on top of an
        // existing one. We don't quietly clobber — they must use the
        // settings UI to remove the current identity (with a written
        // recovery phrase warning) before importing a new one.
        setAuthError(
          'An identity already exists on this device. Sign in with your existing identity or remove it from settings before importing a new one.',
        );
      } else {
        setAuthError(extractAuthErrorMessage(err, 'Failed to import identity'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [phraseWords, importIdentity, router, setAuthError, setRecoveryPhraseAcknowledgedPersisted]);

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
    />
  );
}

